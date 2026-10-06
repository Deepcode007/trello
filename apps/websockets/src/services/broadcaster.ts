import { EventEmitter } from "node:events";
import type { Server } from "bun";
import {
    type WebSocketData,
    type BroadcastEvent,
    type CardMovedPayload,
    type CardCreatedPayload,
    type CardUpdatedPayload,
    type CardDeletedPayload,
    type ListReorderedPayload,
    formatBoardTopic
} from "../types/events";

const GLOBAL_BROADCASTER_KEY = Symbol.for("trello.ws.broadcaster");

export class WebSocketBroadcaster extends EventEmitter {
    private server: Server<WebSocketData> | null = null;
    private wsPort: number = 3001;

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

    public setServer(server: Server<WebSocketData>): void {
        this.server = server;
        if (server.port) {
            this.wsPort = server.port;
        }
    }

    public getServer(): Server<WebSocketData> | null {
        return this.server;
    }

    public isServerAttached(): boolean {
        return this.server !== null;
    }

    public setPort(port: number): void {
        this.wsPort = port;
    }

    public publish(topic: string, message: unknown): number {
        const payloadStr = typeof message === "string" ? message : JSON.stringify(message);
        this.emit("publish", { topic, message, raw: payloadStr });

        if (this.server) {
            return this.server.publish(topic, payloadStr);
        }
        return 0;
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

        // Always emit on local EventEmitter for in-process listeners
        this.emit("broadcast", { boardId, topic, event: eventObj, raw: payloadStr });
        this.emit(`board:${boardId}`, eventObj);
        if (topic !== boardId) {
            this.emit(`board:${topic}`, eventObj);
        }

        // If Bun.serve instance is available (same process / dual-server pattern)
        if (this.server) {
            this.server.publish(topic, payloadStr);
            return true;
        }

        // Fallback: If running in separate processes (e.g., Express on 3000 and Bun.serve on 3001)
        try {
            const endpoint = `http://127.0.0.1:${this.wsPort}/internal/broadcast`;
            const internalSecret = process.env.jwt_key || process.env.JWT_SECRET || "";
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
            // WS server is either offline or unreachable; fail gracefully without throwing
            return false;
        }
    }

    // Helper: Card moved across sections or reordered
    public async broadcastCardMoved(boardId: string, payload: CardMovedPayload): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:moved",
            payload
        });
    }

    // Helper: Card created
    public async broadcastCardCreated(boardId: string, cardData: unknown): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:created",
            payload: { cardData }
        });
    }

    // Helper: Card updated
    public async broadcastCardUpdated(boardId: string, cardId: string, updates: unknown): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:updated",
            payload: { cardId, updates }
        });
    }

    // Helper: Card deleted
    public async broadcastCardDeleted(boardId: string, cardId: string): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "card:deleted",
            payload: { cardId }
        });
    }

    // Helper: List / section reordered
    public async broadcastListReordered(boardId: string, listId: string, newPosition: number): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "list:reordered",
            payload: { listId, newPosition }
        });
    }

    // Helper: User joined board
    public async broadcastUserJoined(boardId: string, user: { userId: string; name?: string; email?: string }): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "user:joined",
            payload: { ...user, boardId }
        });
    }

    // Helper: User left board
    public async broadcastUserLeft(boardId: string, userId: string): Promise<boolean> {
        return this.broadcast(boardId, {
            type: "user:left",
            payload: { userId, boardId }
        });
    }
}

export const wsBroadcaster = WebSocketBroadcaster.getInstance();
