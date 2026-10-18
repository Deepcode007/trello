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

export type BoardEventType =
    | "card:created"
    | "card:updated"
    | "card:moved"
    | "card:deleted"
    | "card:member_assigned"
    | "card:member_unassigned"
    | "card:label_added"
    | "card:label_attached"
    | "card:label_removed"
    | "label:created"
    | "checklist:created"
    | "checklist:deleted"
    | "checklist_item:created"
    | "checklist_item:updated"
    | "list:created"
    | "list:updated"
    | "list:reordered"
    | "list:deleted"
    | "comment:created"
    | "comment:updated"
    | "comment:deleted"
    | "board:updated"
    | "board:evicted"
    | "board:member_evicted"
    | "user:joined"
    | "user:left";

// -------------------------------------------------------------
// Card / Issue Payloads
// -------------------------------------------------------------

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

export interface AssignedUser
{
    userId: string;
    email: string;
}

export interface CardMemberAssignedPayload
{
    issueId: string;
    assignedUsers: AssignedUser[];
    boardId?: string;
    [key: string]: unknown;
}

export interface CardMemberUnassignedPayload
{
    issueId: string;
    userId: string;
    email: string;
    boardId?: string;
    [key: string]: unknown;
}

export interface CardLabelAddedPayload
{
    issueId: string;
    label: {
        id: string;
        name: string;
        color: string;
        boardId?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export type CardLabelAttachedPayload = CardLabelAddedPayload;

export interface CardLabelRemovedPayload
{
    issueId: string;
    labelId: string;
    [key: string]: unknown;
}

export interface LabelCreatedPayload
{
    label: {
        id: string;
        name: string;
        color: string;
        boardId?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

// -------------------------------------------------------------
// Checklist Payloads
// -------------------------------------------------------------

export interface ChecklistCreatedPayload
{
    issueId: string;
    checklist: unknown;
    [key: string]: unknown;
}

export interface ChecklistDeletedPayload
{
    issueId: string;
    checklistId: string;
    [key: string]: unknown;
}

export interface ChecklistItemCreatedPayload
{
    checklistId: string;
    item: unknown;
    [key: string]: unknown;
}

export interface ChecklistItemUpdatedPayload
{
    itemId: string;
    checklistId: string;
    item: unknown;
    [key: string]: unknown;
}

// -------------------------------------------------------------
// Section / Column Payloads
// -------------------------------------------------------------

export interface ListCreatedPayload
{
    listData: unknown;
    [key: string]: unknown;
}

export interface ListUpdatedPayload
{
    listId: string;
    title?: string;
    wipLimit?: number | null;
    isArchived?: boolean;
    [key: string]: unknown;
}

export interface ListReorderedPayload
{
    listId: string;
    newPosition: number;
    [key: string]: unknown;
}

export interface ListDeletedPayload
{
    listId: string;
    targetSectionId?: string;
    [key: string]: unknown;
}

// -------------------------------------------------------------
// Comment Payloads
// -------------------------------------------------------------

export interface CommentCreatedPayload
{
    comment: unknown;
    issueId: string;
    boardId: string;
    [key: string]: unknown;
}

export interface CommentUpdatedPayload
{
    comment: unknown;
    commentId: string;
    boardId: string;
    [key: string]: unknown;
}

export interface CommentDeletedPayload
{
    commentId: string;
    issueId?: string;
    boardId?: string;
    [key: string]: unknown;
}

// -------------------------------------------------------------
// Board & Presence Payloads
// -------------------------------------------------------------

export interface BoardUpdatedPayload
{
    boardId: string;
    title?: string;
    description?: string | null;
    color?: string | null;
    isArchived?: boolean;
    [key: string]: unknown;
}

export interface BoardEvictedPayload
{
    boardId: string;
    reason?: string;
    [key: string]: unknown;
}

export interface BoardMemberEvictedPayload
{
    userId: string;
    orgId: string;
    boardId: string;
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

export interface UserLeftPayload
{
    userId: string;
    name?: string;
    email?: string;
    boardId?: string;
    [key: string]: unknown;
}

// -------------------------------------------------------------
// Topic Helpers
// -------------------------------------------------------------

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
