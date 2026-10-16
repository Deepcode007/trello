import { EventEmitter } from "node:events";
import type { Server } from "bun";
import { prisma } from "db/prisma";
import
{
    type WebSocketData,
    type BroadcastEvent,
    type CardMovedPayload,
    type CardCreatedPayload,
    type CardUpdatedPayload,
    type CardDeletedPayload,
    type ListReorderedPayload,
    type RecordBoardEventOptions,
    type BroadcastOptions,
    formatBoardTopic,
    cleanBoardId
} from "../types/events";

export type EvictionHandler = (options: {
    userId: string;
    orgId?: string;
    boardIds?: string[];
    reason?: string;
}) => Promise<number | boolean> | number | boolean;

const GLOBAL_BROADCASTER_KEY = Symbol.for("trello.ws.broadcaster");

export class WebSocketBroadcaster extends EventEmitter
{
    private server: Server<WebSocketData> | null = null;
    private wsPort: number = 3001;
    private evictionHandler: EvictionHandler | null = null;

    constructor()
    {
        super();
        const envPort = process.env.ws_port || process.env.WS_PORT;
        if (envPort && !isNaN(Number(envPort)))
        {
            this.wsPort = Number(envPort);
        }
    }

    public static getInstance(): WebSocketBroadcaster
    {
        const globalStore = globalThis as unknown as Record<symbol, WebSocketBroadcaster>;
        if (!globalStore[GLOBAL_BROADCASTER_KEY])
        {
            globalStore[GLOBAL_BROADCASTER_KEY] = new WebSocketBroadcaster();
        }
        return globalStore[GLOBAL_BROADCASTER_KEY];
    }

    public setServer(server: Server<WebSocketData>): void
    {
        this.server = server;
        if (server.port)
        {
            this.wsPort = server.port;
        }
    }

    public getServer(): Server<WebSocketData> | null
    {
        return this.server;
    }

    public isServerAttached(): boolean
    {
        return this.server !== null;
    }

    public setPort(port: number): void
    {
        this.wsPort = port;
    }

    public setEvictionHandler(handler: EvictionHandler): void
    {
        this.evictionHandler = handler;
    }

    public getEvictionHandler(): EvictionHandler | null
    {
        return this.evictionHandler;
    }

    public publish(topic: string, message: unknown): number
    {
        const payloadStr = typeof message === "string" ? message : JSON.stringify(message);
        this.emit("publish", { topic, message, raw: payloadStr });

        if (this.server)
        {
            return this.server.publish(topic, payloadStr);
        }
        return 0;
    }

    public async recordBoardEvent(
        boardId: string,
        eventType: string,
        payload: unknown,
        options?: RecordBoardEventOptions
    ): Promise<{ id: string; sequence: bigint } | null>
    {
        const rawBoardId = cleanBoardId(boardId);
        if (!rawBoardId) return null;

        const isPublished = options?.published ?? false;
        const throwOnError = Boolean(options?.throwOnError || options?.tx);

        const recordOperation = async (tx: any) =>
        {
            if (!tx || !tx.board_events || typeof tx.board_events.findFirst !== "function")
            {
                return null;
            }

            if (typeof tx.$executeRaw === "function")
            {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rawBoardId}))`;
            }

            const lastEvent = await tx.board_events.findFirst({
                where: { boardId: rawBoardId },
                orderBy: { sequence: "desc" },
                select: { sequence: true }
            });

            return tx.board_events.create({
                data: {
                    boardId: rawBoardId,
                    sequence: (lastEvent?.sequence ?? 0n) + 1n,
                    eventType,
                    payload: (payload ?? {}) as any,
                    published: isPublished,
                    publishedAt: isPublished ? new Date() : null
                },
                select: { id: true, sequence: true }
            });
        };

        if (options?.tx)
        {
            try
            {
                return await recordOperation(options.tx);
            } catch (err)
            {
                console.error(`[Broadcaster] Failed to record board event for board ${rawBoardId} in transaction:`, err);
                if (throwOnError) throw err;
                return null;
            }
        }

        try
        {
            return await prisma.$transaction(recordOperation);
        } catch (err)
        {
            console.error(`[Broadcaster] Failed to record board event for board ${rawBoardId}:`, err);
            if (throwOnError) throw err;
            return null;
        }
    }

    public async markEventPublished(eventId: string, publishedAt: Date = new Date()): Promise<boolean>
    {
        if (!eventId || typeof eventId !== "string") return false;
        try
        {
            if (prisma && prisma.board_events && typeof prisma.board_events.update === "function")
            {
                await prisma.board_events.update({
                    where: { id: eventId },
                    data: {
                        published: true,
                        publishedAt
                    }
                });
                return true;
            }
        } catch (err)
        {
            console.error(`[Broadcaster] Failed to mark board event ${eventId} as published:`, err);
        }
        return false;
    }

    public async retryPendingEvents(boardId?: string, limit: number = 50): Promise<number>
    {
        const rawBoardId = boardId ? cleanBoardId(boardId) : undefined;
        try
        {
            if (!prisma?.board_events?.findMany) return 0;

            const pendingEvents = await prisma.board_events.findMany({
                where: {
                    published: false,
                    ...(rawBoardId ? { boardId: rawBoardId } : {})
                },
                orderBy: { sequence: "asc" },
                take: limit
            });

            let publishedCount = 0;
            for (const evt of pendingEvents)
            {
                const success = await this.broadcast(
                    evt.boardId,
                    {
                        type: evt.eventType,
                        payload: evt.payload
                    },
                    {
                        eventId: evt.id,
                        sequence: evt.sequence
                    }
                );
                if (success)
                {
                    publishedCount++;
                }
            }
            return publishedCount;
        } catch (err)
        {
            console.error("[Broadcaster] Failed to retry pending outbox events:", err);
            return 0;
        }
    }

    public async executeWithOutbox<R>(
        boardId: string,
        event: { type: string; payload: unknown },
        operation: (tx: any) => Promise<R>
    ): Promise<{ result: R; eventId: string; sequence: bigint; published: boolean }>
    {
        const rawBoardId = cleanBoardId(boardId);
        if (!rawBoardId) throw new Error("Invalid board ID for outbox transaction");

        const { opResult, recordedEvent } = await prisma.$transaction(async (tx) =>
        {
            const opResult = await operation(tx);
            const recordedEvent = await this.recordBoardEvent(rawBoardId, event.type, event.payload, {
                tx,
                published: false,
                throwOnError: true
            });
            if (!recordedEvent)
            {
                throw new Error(`Failed to record outbox event for board ${rawBoardId}`);
            }
            return { opResult, recordedEvent };
        });

        const published = await this.broadcast(rawBoardId, {
            type: event.type,
            payload: event.payload
        }, {
            eventId: recordedEvent.id,
            sequence: recordedEvent.sequence
        });

        return {
            result: opResult,
            eventId: recordedEvent.id,
            sequence: recordedEvent.sequence,
            published
        };
    }

    public async broadcast<T = unknown>(
        boardId: string,
        event: BroadcastEvent<T> | string,
        options?: BroadcastOptions
    ): Promise<boolean>
    {
        if (!boardId || typeof boardId !== "string") return false;

        const topic = formatBoardTopic(boardId);
        if (!topic) return false;
        let eventObj: BroadcastEvent<T>;
        let payloadStr: string;

        if (typeof event === "string")
        {
            try
            {
                eventObj = JSON.parse(event) as BroadcastEvent<T>;
                payloadStr = event;
            } catch
            {
                eventObj = { type: "message", payload: event as unknown as T, timestamp: Date.now() };
                payloadStr = JSON.stringify(eventObj);
            }
        } else
        {
            eventObj = {
                ...event,
                timestamp: event.timestamp ?? Date.now()
            };
            payloadStr = JSON.stringify(eventObj);
        }

        let eventId: string | undefined = options?.eventId ?? (eventObj as any).eventId;
        let sequence: string | undefined = options?.sequence !== undefined ? options.sequence.toString() : (eventObj as any).sequence;

        // Persist event into board_events outbox table if not a system/ping heartbeat and not pre-recorded
        if (eventObj.type !== "ping" && eventObj.type !== "pong" && !options?.skipRecording)
        {
            if (!eventId || sequence === undefined)
            {
                try
                {
                    const recorded = await this.recordBoardEvent(boardId, eventObj.type, eventObj.payload, {
                        tx: options?.tx,
                        published: false,
                        throwOnError: Boolean(options?.throwOnError || options?.tx)
                    });
                    if (recorded)
                    {
                        eventId = recorded.id;
                        sequence = recorded.sequence.toString();
                        (eventObj as any).sequence = sequence;
                        (eventObj as any).eventId = eventId;
                        payloadStr = JSON.stringify(eventObj);
                    } else
                    {
                        console.error(`[Broadcaster] Failed to persist outbox event for board ${boardId} (${eventObj.type})`);
                        if (options?.throwOnError)
                        {
                            throw new Error(`Failed to persist outbox event for board ${boardId} (${eventObj.type})`);
                        }
                    }
                } catch (err)
                {
                    console.error(`[Broadcaster] Outbox persistence error for board ${boardId}:`, err);
                    if (options?.throwOnError || options?.tx) throw err;
                }
            } else
            {
                (eventObj as any).sequence = sequence;
                (eventObj as any).eventId = eventId;
                payloadStr = JSON.stringify(eventObj);
            }
        }

        // Always emit on local EventEmitter for in-process listeners
        this.emit("broadcast", { boardId, topic, event: eventObj, raw: payloadStr });
        this.emit(`board:${boardId}`, eventObj);
        if (topic !== boardId)
        {
            this.emit(`board:${topic}`, eventObj);
        }

        let transportSuccess = false;

        // If Bun.serve instance is available (same process / dual-server pattern)
        if (this.server)
        {
            this.server.publish(topic, payloadStr);
            transportSuccess = true;
        } else
        {
            // Fallback: If running in separate processes (e.g., Express on 3000 and Bun.serve on 3001)
            try
            {
                const endpoint = `http://127.0.0.1:${this.wsPort}/internal/broadcast`;
                const internalSecret = process.env.INTERNAL_BROADCAST_SECRET || process.env.jwt_key || process.env.JWT_SECRET || "";
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (internalSecret)
                {
                    headers["x-internal-secret"] = internalSecret;
                }

                const res = await fetch(endpoint, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ boardId, event: eventObj }),
                    signal: AbortSignal.timeout(1000)
                });
                transportSuccess = res.ok;
            } catch
            {
                // WS server is either offline or unreachable; fail gracefully without throwing
                transportSuccess = false;
            }
        }

        // Only mark event published AFTER successful transport!
        if (transportSuccess && eventId)
        {
            await this.markEventPublished(eventId);
        }

        return transportSuccess;
    }

    public async evictUser(userId: string, orgId?: string, boardIds?: string[], maxRetries: number = 2): Promise<boolean>
    {
        if (!userId || typeof userId !== "string" || !userId.trim())
        {
            return false;
        }

        this.emit("evictUser", { userId, orgId, boardIds });

        if (this.evictionHandler)
        {
            try
            {
                await this.evictionHandler({
                    userId,
                    orgId,
                    boardIds,
                    reason: "FORBIDDEN_REVOKED: Organization membership terminated"
                });
                return true;
            } catch
            {
                return false;
            }
        }

        const endpoint = `http://127.0.0.1:${this.wsPort}/internal/evict-user`;
        const internalSecret = process.env.INTERNAL_BROADCAST_SECRET || process.env.jwt_key || process.env.JWT_SECRET || "";
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (internalSecret) headers["x-internal-secret"] = internalSecret;
        const bodyStr = JSON.stringify({
            userId,
            orgId,
            boardIds,
            reason: "FORBIDDEN_REVOKED: Organization membership terminated"
        });

        for (let attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                const res = await fetch(endpoint, {
                    method: "POST",
                    headers,
                    body: bodyStr,
                    signal: AbortSignal.timeout(1000)
                });
                if (res.ok) return true;
            } catch
            {
                // Network error / timeout
            }
            if (attempt < maxRetries)
            {
                await new Promise((r) => setTimeout(r, (attempt + 1) * 50));
            }
        }
        return false;
    }

    // Helper: Card moved across sections or reordered
    public async broadcastCardMoved(boardId: string, payload: CardMovedPayload, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:moved",
            payload
        }, options);
    }

    // Helper: Card created
    public async broadcastCardCreated(boardId: string, cardData: unknown, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:created",
            payload: { cardData }
        }, options);
    }

    // Helper: Card updated
    public async broadcastCardUpdated(boardId: string, cardId: string, updates: unknown, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:updated",
            payload: { cardId, updates }
        }, options);
    }

    // Helper: Card deleted
    public async broadcastCardDeleted(boardId: string, cardId: string, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:deleted",
            payload: { cardId }
        }, options);
    }

    // Helper: List / section reordered
    public async broadcastListReordered(boardId: string, listId: string, newPosition: number, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "list:reordered",
            payload: { listId, newPosition }
        }, options);
    }

    // Helper: User joined board
    public async broadcastUserJoined(boardId: string, user: { userId: string; name?: string; email?: string }, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "user:joined",
            payload: { ...user, boardId }
        }, options);
    }

    // Helper: User left board
    public async broadcastUserLeft(boardId: string, userId: string, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "user:left",
            payload: { userId, boardId }
        }, options);
    }
}

export const wsBroadcaster = WebSocketBroadcaster.getInstance();
