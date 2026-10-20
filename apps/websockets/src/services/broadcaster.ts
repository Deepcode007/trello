import { EventEmitter } from "node:events";
import { env } from "../env";
import { formatBoardTopic, type BroadcastEvent, type BroadcastOptions, type CardMovedPayload } from "realtime";

export type EvictionHandler = (options: {
    userId: string;
    orgId?: string;
    boardIds?: string[];
    reason?: string;
}) => Promise<number | boolean> | number | boolean;

type InternalServer = { publish?: (topic: string, message: string) => number };
let singleton: WebSocketBroadcaster | undefined;

export class WebSocketBroadcaster extends EventEmitter
{
    private server: InternalServer | null = null;
    private wsPort = Number(env.ws_port);
    private evictionHandler: EvictionHandler | null = null;

    public static getInstance(): WebSocketBroadcaster
    {
        return singleton ??= new WebSocketBroadcaster();
    }

    public setServer(server: InternalServer | null): void { this.server = server; }
    public getServer(): InternalServer | null { return this.server; }
    public isServerAttached(): boolean { return this.server !== null; }
    public setPort(port: number): void { this.wsPort = port; }
    public setEvictionHandler(handler: EvictionHandler): void { this.evictionHandler = handler; }
    public getEvictionHandler(): EvictionHandler | null { return this.evictionHandler; }

    public publish(topic: string, message: unknown): number
    {
        const raw = typeof message === "string" ? message : JSON.stringify(message);
        this.emit("publish", { topic, message, raw });
        return this.server?.publish?.(topic, raw) ?? 0;
    }

    public async broadcast<T = unknown>(boardId: string, event: BroadcastEvent<T> | string, options?: BroadcastOptions): Promise<boolean>
    {
        if (!boardId || typeof boardId !== "string") return false;
        const topic = formatBoardTopic(boardId);
        if (!topic) return false;

        let eventObj: BroadcastEvent<T>;
        if (typeof event === "string")
        {
            try { eventObj = JSON.parse(event) as BroadcastEvent<T>; }
            catch { eventObj = { type: "message", payload: event as T }; }
        }
        else eventObj = { ...event, timestamp: event.timestamp ?? Date.now() };

        if (options?.eventId ?? eventObj.eventId) eventObj.eventId = options?.eventId ?? eventObj.eventId;
        if (options?.sequence !== undefined) eventObj.sequence = options.sequence.toString();
        const raw = JSON.stringify(eventObj);
        this.emit("broadcast", { boardId, topic, event: eventObj, raw });
        this.emit(`board:${boardId}`, eventObj);
        if (topic !== boardId) this.emit(`board:${topic}`, eventObj);

        if (this.server?.publish)
        {
            this.server.publish(topic, raw);
            return true;
        }
        try
        {
            const endpoint = `${(env.WS_INTERNAL_URL || `http://127.0.0.1:${this.wsPort}`).replace(/\/$/, "")}/internal/broadcast`;
            const secret = env.INTERNAL_BROADCAST_SECRET || env.jwt_key || "";
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-internal-secret": secret },
                body: JSON.stringify({ boardId, event: eventObj }),
                signal: AbortSignal.timeout(1000)
            });
            return response.ok;
        }
        catch { return false; }
    }

    public async evictUser(userId: string, orgId?: string, boardIds?: string[], maxRetries = 2): Promise<boolean>
    {
        if (!userId || typeof userId !== "string" || !userId.trim()) return false;
        this.emit("evictUser", { userId, orgId, boardIds });
        if (this.evictionHandler)
        {
            try { return Boolean(await this.evictionHandler({ userId, orgId, boardIds, reason: "FORBIDDEN_REVOKED: Organization membership terminated" })); }
            catch { return false; }
        }
        const endpoint = `${(env.WS_INTERNAL_URL || `http://127.0.0.1:${this.wsPort}`).replace(/\/$/, "")}/internal/evict-user`;
        for (let attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-internal-secret": env.INTERNAL_BROADCAST_SECRET || env.jwt_key || "" },
                    body: JSON.stringify({ userId, orgId, boardIds, reason: "FORBIDDEN_REVOKED: Organization membership terminated" }),
                    signal: AbortSignal.timeout(1000)
                });
                if (response.ok) return true;
            }
            catch { /* retry transient transport failures */ }
            if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 50));
        }
        return false;
    }

    public broadcastCardMoved(boardId: string, payload: CardMovedPayload, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "card:moved", payload }, options); }
    public broadcastCardCreated(boardId: string, cardData: unknown, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "card:created", payload: { cardData } }, options); }
    public broadcastCardUpdated(boardId: string, cardId: string, updates: unknown, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "card:updated", payload: { cardId, updates } }, options); }
    public broadcastCardDeleted(boardId: string, cardId: string, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "card:deleted", payload: { cardId } }, options); }
    public broadcastListReordered(boardId: string, listId: string, newPosition: number, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "list:reordered", payload: { listId, newPosition } }, options); }
    public broadcastUserJoined(boardId: string, user: { userId: string; name?: string; email?: string }, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "user:joined", payload: { ...user, boardId } }, options); }
    public broadcastUserLeft(boardId: string, userId: string, options?: BroadcastOptions): Promise<boolean> { return this.broadcast(boardId, { type: "user:left", payload: { userId, boardId } }, options); }
}

export const wsBroadcaster = WebSocketBroadcaster.getInstance();
import { env } from "../env";
