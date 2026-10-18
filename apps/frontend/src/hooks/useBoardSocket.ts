import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import { WS_BASE_URL, api } from "../lib/api";
import type {
  BroadcastEvent,
  UserJoinedPayload,
  UserLeftPayload,
  CommentCreatedPayload,
  BoardEvictedPayload
} from "realtime";

export function useBoardSocket(boardId?: string) {
  const queryClient = useQueryClient();
  const token = useAuthStore(s => s.token);
  const {
    setConnected,
    setActiveBoardId,
    addCollaborator,
    removeCollaborator,
    setLastSeenSequence,
    resetBoardState
  } = useBoardStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const lastSeqRef = useRef<string | null>(null);

  const handleBroadcastEvent = useCallback((event: BroadcastEvent) => {
    if (!event || !event.type) return;

    if (event.sequence) {
      lastSeqRef.current = String(event.sequence);
      setLastSeenSequence(String(event.sequence));
    }

    switch (event.type) {
      case "user:joined": {
        const payload = event.payload as UserJoinedPayload;
        if (payload?.userId) {
          addCollaborator({
            userId: payload.userId,
            name: payload.name,
            email: payload.email
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

      case "board:evicted":
      case "board:member_evicted": {
        const payload = event.payload as BoardEvictedPayload;
        alert(payload?.reason || "You have been removed from this board.");
        window.location.href = "/";
        break;
      }

      case "card:moved":
      case "card:created":
      case "card:updated":
      case "card:deleted":
      case "card:member_assigned":
      case "card:member_unassigned":
      case "card:label_added":
      case "card:label_attached":
      case "card:label_removed":
      case "list:created":
      case "list:updated":
      case "list:reordered":
      case "list:deleted":
      case "checklist:created":
      case "checklist:deleted":
      case "checklist_item:created":
      case "checklist_item:updated":
      case "board:updated": {
        if (boardId) {
          queryClient.invalidateQueries({ queryKey: ["board", boardId] });
        }
        break;
      }

      case "comment:created":
      case "comment:updated":
      case "comment:deleted": {
        const payload = event.payload as CommentCreatedPayload;
        if (payload?.issueId) {
          queryClient.invalidateQueries({ queryKey: ["comments", payload.issueId] });
        }
        break;
      }

      default:
        break;
    }
  }, [boardId, queryClient, addCollaborator, removeCollaborator, setLastSeenSequence]);

  // Catch-up missed events via REST after socket reconnects
  const syncMissedEvents = useCallback(async (bId: string, sinceSeq: string) => {
    try {
      const res = await api.get(`/api/boards/${bId}/events?sinceSeq=${sinceSeq}`);
      if (res.data?.success && Array.isArray(res.data.data)) {
        for (const evt of res.data.data) {
          handleBroadcastEvent(evt);
        }
      }
    } catch (err) {
      console.warn("Failed to catch up missed events, invalidating board cache:", err);
      queryClient.invalidateQueries({ queryKey: ["board", bId] });
    }
  }, [queryClient, handleBroadcastEvent]);

  const connect = useCallback(() => {
    if (!boardId || !token) return;

    const wsUrl = `${WS_BASE_URL}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setActiveBoardId(boardId);
      retryCountRef.current = 0;

      // Join board room
      ws.send(JSON.stringify({ action: "join", boardId }));

      // If we previously had a sequence, catch up missing events
      if (lastSeqRef.current) {
        syncMissedEvents(boardId, lastSeqRef.current);
      }

      // Heartbeat interval
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: "ping" }));
        }
      }, 25000);
    };

    ws.onmessage = evt => {
      try {
        const data = JSON.parse(evt.data);
        if (data.action === "ping") {
          ws.send(JSON.stringify({ action: "pong" }));
          return;
        }
        handleBroadcastEvent(data);
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

      // Exponential backoff reconnect
      const delay = Math.min(1000 * 2 ** retryCountRef.current, 10000);
      retryCountRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = err => {
      console.warn("WebSocket error:", err);
      ws.close();
    };
  }, [boardId, token, setConnected, setActiveBoardId, syncMissedEvents, handleBroadcastEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN && boardId) {
          wsRef.current.send(JSON.stringify({ action: "leave", boardId }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
      resetBoardState();
    };
  }, [connect, boardId, resetBoardState]);

  return {
    isConnected: useBoardStore(s => s.connected),
    collaborators: useBoardStore(s => s.collaborators)
  };
}
