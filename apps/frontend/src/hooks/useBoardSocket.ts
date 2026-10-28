import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import { api } from "../lib/api";
import { useSocketContext } from "../context/SocketContext";
import { getAppSocketManager } from "./useAppSocket";
import type { BoardDetail, BoardSection, BoardIssue } from "../lib/board-api";
import type {
  BroadcastEvent,
  UserJoinedPayload,
  UserLeftPayload,
  CommentCreatedPayload,
  CommentUpdatedPayload,
  CommentDeletedPayload,
  BoardEvictedPayload,
  BoardMemberEvictedPayload,
  BoardUpdatedPayload,
  CardMovedPayload,
  CardCreatedPayload,
  CardUpdatedPayload,
  CardDeletedPayload,
  ListCreatedPayload,
  ListUpdatedPayload,
  ListReorderedPayload,
  ListDeletedPayload
} from "realtime";

export interface CatchUpEvent {
  sequence?: string | number | bigint;
  eventType?: string;
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

export type IncomingSocketEvent = BroadcastEvent | CatchUpEvent;

// ============================================================================
// Fine-Grained Cache Reducer Helpers for BoardDetail
// ============================================================================

export function applyCardMoved(board: BoardDetail, payload: CardMovedPayload): BoardDetail {
  if (!board.section || !payload.cardId) return board;
  let targetCard: BoardIssue | null = null;

  // 1. Remove card from source section
  const newSections = board.section.map(sec => {
    const found = sec.issues?.find(iss => iss.id === payload.cardId);
    if (found) {
      targetCard = found;
      return {
        ...sec,
        issues: (sec.issues || []).filter(iss => iss.id !== payload.cardId)
      };
    }
    return sec;
  });

  if (!targetCard) return board;

  const validCard: BoardIssue = targetCard;
  const destSectionId = payload.destList || validCard.sectionId;
  const newPosition = payload.position !== undefined ? payload.position : validCard.position;

  const updatedCard: BoardIssue = {
    ...validCard,
    sectionId: destSectionId,
    position: newPosition
  };

  // 2. Insert into destination section and resort
  const finalSections = newSections.map(sec => {
    if (sec.id === destSectionId) {
      const issues = [...(sec.issues || []), updatedCard].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.id.localeCompare(b.id);
      });
      return { ...sec, issues };
    }
    return sec;
  });

  return { ...board, section: finalSections };
}

export function applyCardCreated(board: BoardDetail, payload: CardCreatedPayload): BoardDetail {
  const card = payload.cardData as BoardIssue | undefined;
  if (!board.section || !card?.id || !card.sectionId) return board;

  const alreadyExists = board.section.some(sec => sec.issues?.some(iss => iss.id === card.id));
  if (alreadyExists) return board;

  const finalSections = board.section.map(sec => {
    if (sec.id === card.sectionId) {
      const issues = [...(sec.issues || []), card].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.id.localeCompare(b.id);
      });
      return { ...sec, issues };
    }
    return sec;
  });

  return { ...board, section: finalSections };
}

export function applyCardUpdated(board: BoardDetail, payload: CardUpdatedPayload): BoardDetail {
  if (!board.section || !payload.cardId || !payload.updates) return board;
  const updates = payload.updates as Partial<BoardIssue>;

  const finalSections = board.section.map(sec => {
    const hasCard = sec.issues?.some(iss => iss.id === payload.cardId);
    if (!hasCard) return sec;
    const issues = (sec.issues || []).map(iss => {
      if (iss.id === payload.cardId) {
        return { ...iss, ...updates };
      }
      return iss;
    }).sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.id.localeCompare(b.id);
    });
    return { ...sec, issues };
  });

  return { ...board, section: finalSections };
}

export function applyCardDeleted(board: BoardDetail, payload: CardDeletedPayload): BoardDetail {
  if (!board.section || !payload.cardId) return board;
  const finalSections = board.section.map(sec => ({
    ...sec,
    issues: (sec.issues || []).filter(iss => iss.id !== payload.cardId)
  }));
  return { ...board, section: finalSections };
}

export function applyListCreated(board: BoardDetail, payload: ListCreatedPayload): BoardDetail {
  const list = payload.listData as BoardSection | undefined;
  if (!board.section || !list?.id) return board;

  if (board.section.some(sec => sec.id === list.id)) return board;

  const newSection: BoardSection = {
    ...list,
    issues: list.issues || []
  };

  const finalSections = [...board.section, newSection].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });

  return { ...board, section: finalSections };
}

export function applyListUpdated(board: BoardDetail, payload: ListUpdatedPayload): BoardDetail {
  if (!board.section || !payload.listId) return board;
  const finalSections = board.section.map(sec => {
    if (sec.id === payload.listId) {
      return {
        ...sec,
        title: payload.title !== undefined ? payload.title : sec.title,
        wipLimit: payload.wipLimit !== undefined ? payload.wipLimit : sec.wipLimit,
        isArchived: payload.isArchived !== undefined ? payload.isArchived : sec.isArchived
      };
    }
    return sec;
  });
  return { ...board, section: finalSections };
}

export function applyListReordered(board: BoardDetail, payload: ListReorderedPayload): BoardDetail {
  if (!board.section || !payload.listId || payload.newPosition === undefined) return board;
  const finalSections = board.section.map(sec => {
    if (sec.id === payload.listId) {
      return { ...sec, position: payload.newPosition };
    }
    return sec;
  }).sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
  return { ...board, section: finalSections };
}

export function applyListDeleted(board: BoardDetail, payload: ListDeletedPayload): BoardDetail {
  if (!board.section || !payload.listId) return board;
  const deletedSec = board.section.find(sec => sec.id === payload.listId);
  const remainingSections = board.section.filter(sec => sec.id !== payload.listId);

  if (payload.targetSectionId && deletedSec?.issues?.length) {
    const reassignedIssues = deletedSec.issues.map(iss => ({
      ...iss,
      sectionId: payload.targetSectionId!
    }));

    const finalSections = remainingSections.map(sec => {
      if (sec.id === payload.targetSectionId) {
        const issues = [...(sec.issues || []), ...reassignedIssues].sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          return a.id.localeCompare(b.id);
        });
        return { ...sec, issues };
      }
      return sec;
    });

    return { ...board, section: finalSections };
  }

  return { ...board, section: remainingSections };
}

export function applyBoardUpdated(board: BoardDetail, payload: BoardUpdatedPayload): BoardDetail {
  return {
    ...board,
    title: payload.title !== undefined ? payload.title : board.title,
    description: payload.description !== undefined ? payload.description : board.description,
    color: payload.color !== undefined ? payload.color : board.color,
    isArchived: payload.isArchived !== undefined ? payload.isArchived : board.isArchived
  };
}

export function processCollaboratorsFromEvent(
  event: IncomingSocketEvent
): Record<string, { userId: string; name?: string; email?: string; role?: string; rank?: string }> | null {
  if (!event) return null;
  const eventType =
    ("type" in event && typeof event.type === "string" ? event.type : undefined) ||
    ("eventType" in event && typeof event.eventType === "string" ? event.eventType : undefined);

  if (eventType === "joined" || eventType === "presence:sync") {
    const rawUsers =
      (event as { users?: unknown }).users ??
      (event as { payload?: { users?: unknown } }).payload?.users ??
      (event as { payload?: unknown }).payload;
    if (Array.isArray(rawUsers)) {
      const isEmailLike = (val?: string) => Boolean(val && val.includes("@"));
      const map: Record<string, { userId: string; name?: string; email?: string; role?: string; rank?: string }> = {};
      for (const u of rawUsers) {
        if (u && typeof u === "object" && "userId" in u && typeof (u as { userId: unknown }).userId === "string") {
          const userObj = u as { userId: string; name?: string; email?: string; role?: string; rank?: string };
          const rawName = userObj.name?.trim();
          const cleanName =
            (rawName && !isEmailLike(rawName))
              ? rawName
              : (userObj.email && userObj.email.includes("@") ? userObj.email.split("@")[0] : rawName);

          const role = userObj.role || userObj.rank;
          map[userObj.userId] = {
            userId: userObj.userId,
            name: cleanName,
            email: userObj.email,
            role,
            rank: role
          };
        }
      }
      return map;
    }
  }
  return null;
}

// ============================================================================
// useBoardSocket Hook
// ============================================================================

export function useBoardSocket(boardId?: string) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const socketContext = useSocketContext();

  const {
    setConnectionStatus,
    setActiveBoardId,
    addCollaborator,
    removeCollaborator,
    setCollaborators,
    setLastSeenSequence,
    resetBoardState
  } = useBoardStore();

  const lastSeqRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  // Synchronize board store connection status with socket context status
  useEffect(() => {
    if (socketContext?.connectionStatus) {
      setConnectionStatus(socketContext.connectionStatus);
    }
  }, [socketContext?.connectionStatus, setConnectionStatus]);

  const handleBroadcastEvent = useCallback((event: IncomingSocketEvent) => {
    if (!event) return;
    const eventType = ("type" in event && typeof event.type === "string" ? event.type : undefined) ||
      ("eventType" in event && typeof event.eventType === "string" ? event.eventType : undefined);
    if (!eventType) return;

    // Sequence tracking with BigInt monotonicity check
    const sequence = event.sequence !== undefined ? String(event.sequence) : undefined;
    if (sequence) {
      try {
        if (!lastSeqRef.current || BigInt(sequence) > BigInt(lastSeqRef.current)) {
          lastSeqRef.current = sequence;
          setLastSeenSequence(sequence);
        }
      } catch {
        lastSeqRef.current = sequence;
        setLastSeenSequence(sequence);
      }
    }

    switch (eventType) {
      case "joined":
      case "presence:sync": {
        const map = processCollaboratorsFromEvent(event);
        if (map) {
          setCollaborators(map);
        }
        break;
      }

      case "user:joined": {
        const payload = event.payload as UserJoinedPayload & { role?: string; rank?: string };
        if (payload?.userId) {
          const rawName = payload.name?.trim();
          const isEmailLike = (val?: string) => Boolean(val && val.includes("@"));
          const cleanName =
            (rawName && !isEmailLike(rawName))
              ? rawName
              : (payload.email && payload.email.includes("@") ? payload.email.split("@")[0] : (rawName || "User"));

          const role = payload.role || payload.rank;
          addCollaborator({
            userId: payload.userId,
            name: cleanName,
            email: payload.email,
            role,
            rank: role
          });
        }
        break;
      }

      case "user:left": {
        const payload = event.payload as UserLeftPayload;
        if (payload?.userId) {
          removeCollaborator(payload.userId);
        }
        break;
      }

      case "board:evicted": {
        const payload = event.payload as BoardEvictedPayload;
        alert(payload?.reason || "You have been removed from this board.");
        window.location.href = "/";
        break;
      }

      case "board:member_evicted": {
        const payload = event.payload as BoardMemberEvictedPayload;
        const currentUserId = currentUser?.id;
        if (payload?.userId && currentUserId && payload.userId !== currentUserId) {
          removeCollaborator(payload.userId);
        } else {
          alert(payload?.reason || "You have been removed from this board.");
          window.location.href = "/";
        }
        break;
      }

      case "board:deleted": {
        alert("This board has been deleted.");
        window.location.href = "/";
        break;
      }

      // Card Events
      case "card:moved": {
        const payload = event.payload as CardMovedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyCardMoved(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        if (payload?.cardId) {
          queryClient.invalidateQueries({ queryKey: ["issue", payload.cardId] });
        }
        break;
      }

      case "card:created": {
        const payload = event.payload as CardCreatedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyCardCreated(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      case "card:updated": {
        const payload = event.payload as CardUpdatedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyCardUpdated(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        if (payload?.cardId) {
          queryClient.invalidateQueries({ queryKey: ["issue", payload.cardId] });
        }
        break;
      }

      case "card:deleted": {
        const payload = event.payload as CardDeletedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyCardDeleted(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        if (payload?.cardId) {
          queryClient.removeQueries({ queryKey: ["issue", payload.cardId] });
        }
        break;
      }

      case "card:member_assigned":
      case "card:member_unassigned": {
        const payload = event.payload as { issueId?: string };
        if (boardId) {
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        if (payload?.issueId) {
          queryClient.invalidateQueries({ queryKey: ["issue", payload.issueId] });
        }
        break;
      }

      case "card:label_added":
      case "card:label_attached":
      case "card:label_removed": {
        const payload = event.payload as { issueId?: string };
        if (boardId) {
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        if (payload?.issueId) {
          queryClient.invalidateQueries({ queryKey: ["issue", payload.issueId] });
        }
        break;
      }

      case "label:created": {
        if (boardId) {
          queryClient.invalidateQueries({ queryKey: ["labels", boardId] });
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      // Column / Section Events
      case "list:created": {
        const payload = event.payload as ListCreatedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyListCreated(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      case "list:updated": {
        const payload = event.payload as ListUpdatedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyListUpdated(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      case "list:reordered": {
        const payload = event.payload as ListReorderedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyListReordered(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      case "list:deleted": {
        const payload = event.payload as ListDeletedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyListDeleted(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      // Checklists
      case "checklist:created":
      case "checklist:deleted":
      case "checklist_item:created":
      case "checklist_item:updated": {
        const payload = event.payload as { issueId?: string };
        if (boardId) {
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        if (payload?.issueId) {
          queryClient.invalidateQueries({ queryKey: ["issue", payload.issueId] });
        } else {
          queryClient.invalidateQueries({ queryKey: ["issue"] });
        }
        break;
      }

      // Comments
      case "comment:created":
      case "comment:updated":
      case "comment:deleted": {
        const payload = event.payload as
          | CommentCreatedPayload
          | CommentUpdatedPayload
          | CommentDeletedPayload
          | undefined;
        const commentObj =
          payload && typeof payload === "object" && "comment" in payload
            ? (payload.comment as { issueId?: string } | null | undefined)
            : null;
        const targetIssueId =
          (payload && "issueId" in payload && typeof payload.issueId === "string"
            ? payload.issueId
            : undefined) || commentObj?.issueId;
        if (targetIssueId) {
          queryClient.invalidateQueries({ queryKey: ["comments", targetIssueId] });
        } else {
          queryClient.invalidateQueries({ queryKey: ["comments"] });
        }
        if (boardId) {
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      // Board Meta
      case "board:updated": {
        const payload = event.payload as BoardUpdatedPayload;
        if (boardId) {
          queryClient.setQueryData<BoardDetail>(["board", boardId], old => old ? applyBoardUpdated(old, payload) : old);
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
          queryClient.invalidateQueries({ queryKey: ["boards"] });
        }
        break;
      }

      default:
        break;
    }
  }, [boardId, queryClient, currentUser?.id, addCollaborator, removeCollaborator, setCollaborators, setLastSeenSequence]);

  // Catch-up missed events via REST after socket reconnects
  const syncMissedEvents = useCallback(async (bId: string, sinceSeq: string) => {
    try {
      const res = await api.get(`/api/boards/${bId}/events?sinceSeq=${encodeURIComponent(sinceSeq)}`);
      if (res.data?.success && Array.isArray(res.data.data)) {
        const sorted = [...res.data.data].sort((a, b) => {
          const seqA = a.sequence !== undefined ? BigInt(a.sequence) : 0n;
          const seqB = b.sequence !== undefined ? BigInt(b.sequence) : 0n;
          return seqA < seqB ? -1 : seqA > seqB ? 1 : 0;
        });

        for (const evt of sorted) {
          handleBroadcastEvent(evt);
        }
      }
    } catch (err) {
      console.warn("Failed to catch up missed events, invalidating board cache:", err);
      queryClient?.invalidateQueries({ queryKey: ["board", bId] });
    }
  }, [queryClient, handleBroadcastEvent]);

  useEffect(() => {
    isMountedRef.current = true;
    lastSeqRef.current = null;

    if (!boardId) {
      return;
    }

    setActiveBoardId(boardId);

    const subscriber = socketContext || getAppSocketManager();
    const unregister = subscriber.registerBoardSubscriber(boardId, {
      onEvent: (event: IncomingSocketEvent) => {
        if (!isMountedRef.current) return;
        handleBroadcastEvent(event);
      },
      onReconnect: () => {
        if (!isMountedRef.current) return;
        if (lastSeqRef.current) {
          syncMissedEvents(boardId, lastSeqRef.current);
        }
      }
    });

    if (lastSeqRef.current) {
      syncMissedEvents(boardId, lastSeqRef.current);
    }

    return () => {
      isMountedRef.current = false;
      if (unregister) {
        unregister();
      }
      resetBoardState();
    };
  }, [boardId, socketContext, setActiveBoardId, resetBoardState, handleBroadcastEvent, syncMissedEvents]);

  return {
    isConnected: socketContext?.isConnected ?? getAppSocketManager().isConnected() ?? useBoardStore(s => s.connected),
    connectionStatus: socketContext?.connectionStatus ?? getAppSocketManager().getConnectionStatus() ?? useBoardStore(s => s.connectionStatus),
    collaborators: useBoardStore(s => s.collaborators),
    lastSeenSequence: useBoardStore(s => s.lastSeenSequence),
    handleBroadcastEvent,
    syncMissedEvents
  };
}
