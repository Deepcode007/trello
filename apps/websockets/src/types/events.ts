export interface WebSocketData
{
    userId: string;
    email?: string;
    name?: string;
    role?: string;
    rank?: string;
    subscriptions: Set<string>;
    connectedAt: number;
    isAlive?: boolean;
    lastPing?: number;
    lastPong?: number;
}

export type ClientAction = "join" | "leave" | "ping" | "pong" | "heartbeat" | "heartbeat_ack" | "subscribe" | "unsubscribe" | "subscribe_user";

export interface ClientMessage
{
    action?: ClientAction;
    type?: ClientAction;
    boardId?: string;
    topic?: string;
    roomId?: string;
    name?: string;
    userId?: string;
    [key: string]: unknown;
}

export { formatBoardTopic, cleanBoardId, formatUserTopic, cleanUserId } from "realtime";
export type {
    BroadcastEvent,
    BroadcastOptions,
    CardMovedPayload,
    CardCreatedPayload,
    CardUpdatedPayload,
    CardDeletedPayload,
    ListReorderedPayload,
    UserJoinedPayload,
    UserLeftPayload,
    UserEventType,
    NotificationType,
    UserNotificationPayload,
    OrgBoardCreatedPayload,
    OrgBoardDeletedPayload,
    OrgBoardColumnsChangedPayload,
    OrgBoardCardsChangedPayload,
    OrgBoardUpdatedPayload
} from "realtime";
