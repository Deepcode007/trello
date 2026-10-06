import { EventEmitter } from "node:events";
import { prisma } from "db/prisma";

const GLOBAL_BROADCASTER_KEY = Symbol.for("trello.ws.broadcaster");

export interface BroadcastEvent<T = unknown> {
    type: string;
    payload: T;
    timestamp?: number;
}

export interface CardMovedPayload {
    cardId: string;
    sourceList?: string | null;
    destList?: string | null;
    position?: number;
    [key: string]: unknown;
}

export interface CardCreatedPayload {
    cardData: unknown;
    [key: string]: unknown;
}

export interface CardUpdatedPayload {
    cardId: string;
    updates: unknown;
    [key: string]: unknown;
}

export interface CardDeletedPayload {
    cardId: string;
    [key: string]: unknown;
}

export interface ListReorderedPayload {
    listId: string;
    newPosition: number;
    [key: string]: unknown;
}

export function formatBoardTopic(boardId: string): string {
    if (!boardId || typeof boardId !== "string" || !boardId.trim()) return "";
    const trimmed = boardId.trim();
    return trimmed.startsWith("board_") ? trimmed : `board_${trimmed}`;
}

export function cleanBoardId(topicOrBoardId: string): string {
    if (!topicOrBoardId || typeof topicOrBoardId !== "string" || !topicOrBoardId.trim()) return "";
    const trimmed = topicOrBoardId.trim();
    return trimmed.startsWith("board_") ? trimmed.slice(6) : trimmed;
}

export type EvictionHandler = (options: {
    userId: string;
    orgId?: string;
    boardIds?: string[];
    reason?: string;
}) => Promise<number | boolean> | number | boolean;

export class WebSocketBroadcaster extends EventEmitter {
    private server: any = null;
    private wsPort: number = 3001;
    private evictionHandler: EvictionHandler | null = null;

    constructor() {
        super();
        const envPort = process.env.ws_port || process.env.WS_PORT;
        if (envPort && !isNaN(Number(envPort))) {
            this.wsPort = Number(envPort);
        }
    }

    public static getInstance(): WebSocketBroadcaster {
        const globalStore = globalThis as unknown as Record<symbol, WebSocketBroadcaster>;
        if (!globalStore[GLOBAL_BROADCASTER_KEY]) {
            globalStore[GLOBAL_BROADCASTER_KEY] = new WebSocketBroadcaster();
        }
        return globalStore[GLOBAL_BROADCASTER_KEY];
    }

    public setServer(server: any): void {
        this.server = server;
        if (server?.port) {
            this.wsPort = server.port;
        }
    }

    public getServer(): any {
        return this.server;
    }

    public isServerAttached(): boolean {
        return this.server !== null;
    }

    public setPort(port: number): void {
        this.wsPort = port;
    }

    public setEvictionHandler(handler: EvictionHandler): void {
        this.evictionHandler = handler;
    }

    public getEvictionHandler(): EvictionHandler | null {
        return this.evictionHandler;
    }

    public publish(topic: string, message: unknown): number {
        const payloadStr = typeof message === "string" ? message : JSON.stringify(message);
        this.emit("publish", { topic, message, raw: payloadStr });

        if (this.server && typeof this.server.publish === "function") {
            return this.server.publish(topic, payloadStr);
        }
        return 0;
    }

    public async recordBoardEvent(
        boardId: string,
        eventType: string,
        payload: unknown
    ): Promise<{ id: string; sequence: bigint } | null> {
        const rawBoardId = cleanBoardId(boardId);
        if (!rawBoardId) return null;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const lastEvent = await prisma.board_events.findFirst({
                    where: { boardId: rawBoardId },
                    orderBy: { sequence: "desc" },
                    select: { sequence: true }
                });
                const nextSeq = (lastEvent?.sequence ?? 0n) + 1n;

                const record = await prisma.board_events.create({
                    data: {
                        boardId: rawBoardId,
                        sequence: nextSeq,
                        eventType,
                        payload: (payload ?? {}) as any,
                        published: true,
                        publishedAt: new Date()
                    },
                    select: {
                        id: true,
                        sequence: true
                    }
                });
                return record;
            } catch (err: any) {
                // Retry if concurrent write resulted in duplicate sequence
                if (err?.code === "P2002" && attempt < 2) {
                    continue;
                }
                return null;
            }
        }
        return null;
    }

    public async broadcast<T = unknown>(boardId: string, event: BroadcastEvent<T> | string): Promise<boolean> {
        if (!boardId || typeof boardId !== "string") return false;

        const topic = formatBoardTopic(boardId);
        if (!topic) return false;
        let eventObj: BroadcastEvent<T>;
        let payloadStr: string;

        if (typeof event === "string") {
            try {
                eventObj = JSON.parse(event) as BroadcastEvent<T>;
                payloadStr = event;
            } catch {
                eventObj = { type: "message", payload: event as unknown as T, timestamp: Date.now() };
                payloadStr = JSON.stringify(eventObj);
            }
        } else {
            eventObj = {
                ...event,
                timestamp: event.timestamp ?? Date.now()
            };
            payloadStr = JSON.stringify(eventObj);
        }

        // Persist event into board_events outbox table if not a system/ping heartbeat
        if (eventObj.type !== "ping" && eventObj.type !== "pong") {
            try {
                const recorded = await this.recordBoardEvent(boardId, eventObj.type, eventObj.payload);
                if (recorded) {
                    (eventObj as any).sequence = recorded.sequence.toString();
                    (eventObj as any).eventId = recorded.id;
                    payloadStr = JSON.stringify(eventObj);
                }
            } catch {}
        }

        // Always emit on local EventEmitter for in-process listeners
        this.emit("broadcast", { boardId, topic, event: eventObj, raw: payloadStr });
        this.emit(`board:${boardId}`, eventObj);
        if (topic !== boardId) {
            this.emit(`board:${topic}`, eventObj);
        }

        // If Bun.serve instance is available (same process / dual-server pattern)
        if (this.server && typeof this.server.publish === "function") {
            this.server.publish(topic, payloadStr);
            return true;
        }

        // Fallback: If running in separate processes (Express on 3000 and Bun.serve on 3001)
        try {
            const endpoint = `http://127.0.0.1:${this.wsPort}/internal/broadcast`;
            const internalSecret = process.env.INTERNAL_BROADCAST_SECRET || process.env.jwt_key || process.env.JWT_SECRET || "";
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (internalSecret) {
                headers["x-internal-secret"] = internalSecret;
            }

            const res = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({ boardId, event: eventObj }),
                signal: AbortSignal.timeout(1000)
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    public async evictUser(userId: string, orgId?: string, boardIds?: string[]): Promise<boolean> {
        if (!userId || typeof userId !== "string" || !userId.trim()) {
            return false;
        }

        this.emit("evictUser", { userId, orgId, boardIds });

        if (this.evictionHandler) {
            try {
                await this.evictionHandler({
                    userId,
                    orgId,
                    boardIds,
                    reason: "FORBIDDEN_REVOKED: Organization membership terminated"
                });
                return true;
            } catch {
                return false;
            }
        }

        try {
            const endpoint = `http://127.0.0.1:${this.wsPort}/internal/evict-user`;
            const internalSecret = process.env.INTERNAL_BROADCAST_SECRET || process.env.jwt_key || process.env.JWT_SECRET || "";
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (internalSecret) headers["x-internal-secret"] = internalSecret;

            const res = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    userId,
                    orgId,
                    boardIds,
                    reason: "FORBIDDEN_REVOKED: Organization membership terminated"
                }),
                signal: AbortSignal.timeout(1000)
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    public async broadcastCardMoved(boardId: string, payload: CardMovedPayload): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:moved",
            payload
        });
    }

    public async broadcastCardCreated(boardId: string, cardData: unknown): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:created",
            payload: { cardData }
        });
    }

    public async broadcastCardUpdated(boardId: string, cardId: string, updates: unknown): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:updated",
            payload: { cardId, updates }
        });
    }

    public async broadcastCardDeleted(boardId: string, cardId: string): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:deleted",
            payload: { cardId }
        });
    }

    public async broadcastListReordered(boardId: string, listId: string, newPosition: number): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "list:reordered",
            payload: { listId, newPosition }
        });
    }

    public async broadcastUserJoined(boardId: string, user: { userId: string; name?: string; email?: string }): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "user:joined",
            payload: { ...user, boardId }
        });
    }

    public async broadcastUserLeft(boardId: string, userId: string): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "user:left",
            payload: { userId, boardId }
        });
    }
}

export const wsBroadcaster = WebSocketBroadcaster.getInstance();
