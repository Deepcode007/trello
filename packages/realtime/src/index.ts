export interface BroadcastEvent<T = unknown>
{
    type: string;
    payload: T;
    timestamp?: number;
    eventId?: string;
    sequence?: string;
}

export interface BroadcastOptions
{
    eventId?: string;
    sequence?: bigint | string;
    tx?: unknown;
    throwOnError?: boolean;
    skipRecording?: boolean;
}

export interface CardMovedPayload
{
    cardId: string;
    sourceList?: string | null;
    destList?: string | null;
    position?: number;
    [key: string]: unknown;
}

export interface CardCreatedPayload
{
    cardData: unknown;
    [key: string]: unknown;
}

export interface CardUpdatedPayload
{
    cardId: string;
    updates: unknown;
    [key: string]: unknown;
}

export interface CardDeletedPayload
{
    cardId: string;
    [key: string]: unknown;
}

export interface ListReorderedPayload
{
    listId: string;
    newPosition: number;
    [key: string]: unknown;
}

export interface UserJoinedPayload
{
    userId: string;
    name?: string;
    email?: string;
    boardId?: string;
    [key: string]: unknown;
}

export interface UserLeftPayload extends Omit<UserJoinedPayload, "name" | "email">
{
    name?: string;
    email?: string;
}

export function formatBoardTopic(boardId: string): string
{
    if (!boardId || typeof boardId !== "string" || !boardId.trim()) return "";
    const trimmed = boardId.trim();
    return trimmed.startsWith("board_") ? trimmed : `board_${trimmed}`;
}

export function cleanBoardId(topicOrBoardId: string): string
{
    if (!topicOrBoardId || typeof topicOrBoardId !== "string" || !topicOrBoardId.trim()) return "";
    const trimmed = topicOrBoardId.trim();
    return trimmed.startsWith("board_") ? trimmed.slice(6) : trimmed;
}
