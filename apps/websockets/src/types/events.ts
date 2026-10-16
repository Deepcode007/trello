export interface WebSocketData
{
    userId: string;
    email?: string;
    name?: string;
    subscriptions: Set<string>;
    connectedAt: number;
    isAlive?: boolean;
    lastPing?: number;
    lastPong?: number;
}

export type ClientAction = "join" | "leave" | "ping" | "pong" | "heartbeat" | "heartbeat_ack" | "subscribe" | "unsubscribe";

export interface ClientMessage
{
    action?: ClientAction;
    type?: ClientAction;
    boardId?: string;
    topic?: string;
    roomId?: string;
    name?: string;
    [key: string]: unknown;
}

export { formatBoardTopic, cleanBoardId } from "realtime";
export type { BroadcastEvent, BroadcastOptions, CardMovedPayload, CardCreatedPayload, CardUpdatedPayload, CardDeletedPayload, ListReorderedPayload, UserJoinedPayload, UserLeftPayload } from "realtime";
