import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { prisma } from "db/prisma";
import { cleanBoardId, formatBoardTopic, type BroadcastEvent, type BroadcastOptions, type CardMovedPayload, type CardCreatedPayload, type CardUpdatedPayload, type CardDeletedPayload, type ListReorderedPayload } from "realtime";

let singleton: WebSocketBroadcaster | undefined;

export { formatBoardTopic, cleanBoardId } from "realtime";
export type { BroadcastEvent, CardMovedPayload, CardCreatedPayload, CardUpdatedPayload, CardDeletedPayload, ListReorderedPayload } from "realtime";

export interface RecordBoardEventOptions
{
    tx?: any;
    published?: boolean;
    throwOnError?: boolean;
}

export type { BroadcastOptions } from "realtime";

export interface OutboxEvent
{
    type: string;
    payload: unknown;
}

type OutboxEventResolver = OutboxEvent | OutboxEvent[] | null | undefined | ((result: any) => OutboxEvent | OutboxEvent[] | null | undefined);

interface ClaimedOutboxEvent
{
    id: string;
    boardId: string;
    sequence: bigint;
    eventType: string;
    payload: unknown;
}

export class WebSocketBroadcaster extends EventEmitter
{
    private wsPort: number = 3001;
    private outboxTimer: ReturnType<typeof setInterval> | null = null;
    private outboxDrain: Promise<string[]> | null = null;
    private outboxQueue: Promise<void> = Promise.resolve();
    private outboxWorkerId: string | null = null;
    private outboxIntervalMs = Math.max(1000, Number(process.env.OUTBOX_RETRY_INTERVAL_MS) || 5000);
    private readonly outboxLeaseMs = Math.max(10000, Number(process.env.OUTBOX_LEASE_MS) || 30000);

    constructor()
    {
        super();
        const envPort = process.env.ws_port;
        if (envPort && !isNaN(Number(envPort)))
        {
            this.wsPort = Number(envPort);
        }
    }

    public static getInstance(): WebSocketBroadcaster
    {
        return singleton ??= new WebSocketBroadcaster();
    }

    public setPort(port: number): void
    {
        this.wsPort = port;
    }

    public publish(topic: string, message: unknown): number
    {
        const payloadStr = typeof message === "string" ? message : JSON.stringify(message);
        this.emit("publish", { topic, message, raw: payloadStr });

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

            if (typeof tx.$queryRaw === "function")
            {
                await tx.$queryRaw`WITH advisory_lock AS MATERIALIZED (
                    SELECT pg_advisory_xact_lock(hashtext(${rawBoardId}))
                )
                SELECT 1::int AS locked FROM advisory_lock`;
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
            } catch (err: any)
            {
                if (err?.code !== "P2003")
                {
                    console.error(`[Broadcaster] Failed to record board event for board ${rawBoardId} in transaction:`, err?.message || err);
                }
                if (throwOnError) throw err;
                return null;
            }
        }

        try
        {
            return await prisma.$transaction(recordOperation);
        } catch (err: any)
        {
            if (err?.code !== "P2003")
            {
                console.error(`[Broadcaster] Failed to record board event for board ${rawBoardId}:`, err?.message || err);
            }
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
                        publishedAt,
                        claimedBy: null,
                        claimExpiresAt: null
                    }
                });
                return true;
            }
        } catch (err: any)
        {
            if (err?.code !== "P2025")
            {
                console.error(`[Broadcaster] Failed to mark board event ${eventId} as published:`, err?.message || err);
            }
        }
        return false;
    }

    public async retryPendingEvents(boardId?: string, limit: number = 50): Promise<number>
    {
        const workerId = this.outboxWorkerId ?? `manual-${randomUUID()}`;
        const rawBoardId = boardId ? cleanBoardId(boardId) : undefined;
        return (await this.drainOutboxSerialized(workerId, rawBoardId, limit)).length;
    }

    public startOutboxWorker(intervalMs = this.outboxIntervalMs): void
    {
        if (this.outboxTimer) return;
        this.outboxWorkerId = `backend-${randomUUID()}`;
        this.outboxIntervalMs = Math.max(1000, intervalMs);
        void this.retryPendingEvents().catch(err => console.error("[Broadcaster] Startup outbox drain failed:", err));
        this.outboxTimer = setInterval(() =>
        {
            void this.retryPendingEvents().catch(err => console.error("[Broadcaster] Outbox drain failed:", err));
        }, this.outboxIntervalMs);
        this.outboxTimer.unref?.();
    }

    public async stopOutboxWorker(): Promise<void>
    {
        if (this.outboxTimer)
        {
            clearInterval(this.outboxTimer);
            this.outboxTimer = null;
        }
        if (this.outboxDrain)
        {
            try { await this.outboxDrain; }
            catch (err) { console.error("[Broadcaster] Failed while stopping outbox drain:", err); }
        }
        await this.outboxQueue;
        const workerId = this.outboxWorkerId;
        this.outboxWorkerId = null;
        if (workerId && prisma?.board_events?.updateMany)
        {
            try
            {
                await prisma.board_events.updateMany({
                    where: { claimedBy: workerId, published: false },
                    data: { claimedBy: null, claimExpiresAt: null }
                });
            } catch (err)
            {
                console.error(`[Broadcaster] Failed to release outbox leases for ${workerId}:`, err);
            }
        }
    }

    private async claimPendingEvents(workerId: string, boardId: string | undefined, limit: number, excludedBoardIds: string[]): Promise<ClaimedOutboxEvent[]>
    {
        return prisma.$transaction(async (tx) => tx.$queryRaw<ClaimedOutboxEvent[]>`
            WITH eligible AS (
                SELECT event."id"
                FROM "board_events" AS event
                WHERE event."published" = false
                  AND (event."claimExpiresAt" IS NULL OR event."claimExpiresAt" < NOW())
                  AND (${boardId ?? null}::text IS NULL OR event."boardId" = ${boardId ?? null})
                  AND NOT (event."boardId" = ANY(${excludedBoardIds}::text[]))
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "board_events" AS earlier
                      WHERE earlier."boardId" = event."boardId"
                        AND earlier."published" = false
                        AND earlier."sequence" < event."sequence"
                  )
                ORDER BY event."createdAt", event."boardId", event."sequence"
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            UPDATE "board_events" AS event
            SET "claimedBy" = ${workerId},
                "claimExpiresAt" = NOW() + (${this.outboxLeaseMs} * INTERVAL '1 millisecond')
            FROM eligible
            WHERE event."id" = eligible."id"
            RETURNING event."id", event."boardId", event."sequence", event."eventType", event."payload"
        `);
    }

    private async drainOutboxSerialized(workerId: string, boardId: string | undefined, limit: number): Promise<string[]>
    {
        const previous = this.outboxQueue;
        let release!: () => void;
        this.outboxQueue = new Promise<void>(resolve => { release = resolve; });
        await previous;
        const drain = this.drainOutbox(workerId, boardId, limit);
        this.outboxDrain = drain;
        try { return await drain; }
        finally
        {
            if (this.outboxDrain === drain) this.outboxDrain = null;
            release();
        }
    }

    private async drainOutbox(workerId: string, boardId?: string, limit = 50): Promise<string[]>
    {
        const publishedIds: string[] = [];
        const excludedBoardIds: string[] = [];
        let claimedCount = 0;
        while (claimedCount < Math.max(1, limit))
        {
            const events = await this.claimPendingEvents(workerId, boardId, Math.max(1, limit - claimedCount), excludedBoardIds) ?? [];
            if (events.length === 0) break;
            claimedCount += events.length;
            const deliveredIds = await Promise.all(events.map(async evt =>
            {
                try
                {
                    const delivered = await this.broadcast(evt.boardId, { type: evt.eventType, payload: evt.payload }, {
                        eventId: evt.id,
                        sequence: evt.sequence,
                        skipRecording: true
                    });
                    if (delivered) return evt.id;
                } catch (err)
                {
                    console.error(`[Broadcaster] Failed to deliver outbox event ${evt.id}:`, err);
                }
                await prisma.board_events.updateMany({
                    where: { id: evt.id, claimedBy: workerId, published: false },
                    data: { claimedBy: null, claimExpiresAt: null }
                });
                excludedBoardIds.push(evt.boardId);
                return null;
            }));
            publishedIds.push(...deliveredIds.filter((id): id is string => id !== null));
        }
        return publishedIds;
    }

    public async executeWithOutbox<R>(
        boardId: string,
        eventOrResolver: OutboxEventResolver,
        operation: (tx: any) => Promise<R>
    ): Promise<{ result: R; events: Array<{ id: string; sequence: bigint }>; eventId?: string; sequence?: bigint; published: boolean }>
    {
        const rawBoardId = cleanBoardId(boardId);
        if (!rawBoardId) throw new Error("Invalid board ID for outbox transaction");

        const transactionResult = await prisma.$transaction(async (tx) =>
        {
            const opResult = await operation(tx);
            const resolved = typeof eventOrResolver === "function" ? eventOrResolver(opResult) : eventOrResolver;
            const eventList = resolved == null ? [] : Array.isArray(resolved) ? resolved : [resolved];
            const records = [];
            for (const evt of eventList)
            {
                const recorded = await this.recordBoardEvent(rawBoardId, evt.type, evt.payload, {
                    tx,
                    published: false,
                    throwOnError: true
                });
                if (!recorded) throw new Error(`Failed to record outbox event for board ${rawBoardId}`);
                records.push(recorded);
            }
            return { opResult, events: records };
        });
        const { opResult, events } = transactionResult as {
            opResult: R;
            events: Array<{ id: string; sequence: bigint }>;
        };

        const publishedIds = events.length === 0 ? [] : await this.drainOutboxSerialized(
            this.outboxWorkerId ?? `mutation-${randomUUID()}`,
            rawBoardId,
            Math.max(50, events.length)
        );
        const published = events.length === 0 || events.every(evt => publishedIds.includes(evt.id));
        return {
            result: opResult,
            events,
            eventId: events[0]?.id,
            sequence: events[0]?.sequence,
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

        let eventId: string | undefined = options?.eventId ?? eventObj.eventId;
        let sequence: string | undefined = options?.sequence !== undefined ? options.sequence.toString() : eventObj.sequence;

        if (eventId)
        {
            eventObj.eventId = eventId;
        }
        if (sequence !== undefined)
        {
            eventObj.sequence = sequence;
        }
        if (eventId || sequence !== undefined)
        {
            payloadStr = JSON.stringify(eventObj);
        }

        // Always emit on local EventEmitter for in-process listeners
        this.emit("broadcast", { boardId, topic, event: eventObj, raw: payloadStr });
        this.emit(`board:${boardId}`, eventObj);
        if (topic !== boardId)
        {
            this.emit(`board:${topic}`, eventObj);
        }

        let transportSuccess = false;

        // The backend and WebSocket server run as separate processes.
        try
        {
            const endpoint = `${(process.env.WS_INTERNAL_URL || `http://127.0.0.1:${this.wsPort}`).replace(/\/$/, "")}/internal/broadcast`;
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
            transportSuccess = false;
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

        const endpoint = `${(process.env.WS_INTERNAL_URL || `http://127.0.0.1:${this.wsPort}`).replace(/\/$/, "")}/internal/evict-user`;
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

    public async broadcastCardMoved(boardId: string, payload: CardMovedPayload, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:moved",
            payload
        }, options);
    }

    public async broadcastCardCreated(boardId: string, cardData: unknown, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:created",
            payload: { cardData }
        }, options);
    }

    public async broadcastCardUpdated(boardId: string, cardId: string, updates: unknown, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:updated",
            payload: { cardId, updates }
        }, options);
    }

    public async broadcastCardDeleted(boardId: string, cardId: string, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "card:deleted",
            payload: { cardId }
        }, options);
    }

    public async broadcastListReordered(boardId: string, listId: string, newPosition: number, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "list:reordered",
            payload: { listId, newPosition }
        }, options);
    }

    public async broadcastUserJoined(boardId: string, user: { userId: string; name?: string; email?: string }, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "user:joined",
            payload: { ...user, boardId }
        }, options);
    }

    public async broadcastUserLeft(boardId: string, userId: string, options?: BroadcastOptions): Promise<boolean>
    {
        return this.broadcast(boardId, {
            type: "user:left",
            payload: { userId, boardId }
        }, options);
    }
}

export const wsBroadcaster = WebSocketBroadcaster.getInstance();
