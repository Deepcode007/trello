import { useEffect, useState, useCallback, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import { useBoardStore } from "../store/useBoardStore";
import { WS_BASE_URL } from "../lib/api";
import type { OrgRole, UserOrgMembership } from "../lib/org-api";
import type { BoardSummary } from "../lib/board-api";
import type { IncomingSocketEvent } from "./useBoardSocket";
import type { ConnectionStatus } from "../store/useBoardStore";

export interface BoardSubscriber {
  boardId: string;
  onEvent: (event: IncomingSocketEvent) => void;
  onReconnect?: () => void;
}

export interface AppSocketContextValue {
  socket: WebSocket | null;
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  send: (data: unknown) => boolean;
  registerBoardSubscriber: (
    boardId: string,
    callbacks: {
      onEvent: (event: IncomingSocketEvent) => void;
      onReconnect?: () => void;
    }
  ) => () => void;
  handleIncomingEvent: (data: unknown) => void;
}

export interface UseAppSocketOptions {
  token?: string | null;
  currentUser?: { id?: string; email?: string; username?: string; name?: string } | null;
  wsUrl?: string;
  manager?: AppSocketManager;
}

// ============================================================================
// AppSocketManager: Central Socket Controller
// ============================================================================

export class AppSocketManager {
  private socket: WebSocket | null = null;
  private connectionStatus: ConnectionStatus = "disconnected";
  private token: string | null = null;
  private currentUser: { id?: string; email?: string; username?: string; name?: string } | null = null;
  private subscribers = new Map<string, BoardSubscriber>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private retryCount = 0;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private wsUrl: string;
  private queryClient: QueryClient | null = null;

  constructor(options?: { wsUrl?: string; queryClient?: QueryClient | null }) {
    this.wsUrl = options?.wsUrl || WS_BASE_URL;
    this.queryClient = options?.queryClient ?? null;
  }

  public setQueryClient(client: QueryClient | null) {
    this.queryClient = client;
  }

  public getSocket(): WebSocket | null {
    return this.socket;
  }

  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  public isConnected(): boolean {
    return this.connectionStatus === "connected";
  }

  public onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: ConnectionStatus) {
    this.connectionStatus = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error("Error in status change listener:", err);
      }
    }
  }

  public connect(token?: string | null, currentUser?: any) {
    if (token !== undefined) {
      this.token = token;
    }
    if (currentUser !== undefined) {
      this.currentUser = currentUser;
    }

    if (!this.token) {
      return;
    }

    // Prevent duplicate sockets if one is already connecting or open
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const fullUrl = `${this.wsUrl}?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(fullUrl);
    this.socket = ws;
    this.setStatus(this.retryCount > 0 ? "reconnecting" : "disconnected");

    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.retryCount = 0;
      this.setStatus("connected");

      // 1. Subscribe to user topic
      try {
        ws.send(JSON.stringify({ action: "subscribe_user" }));
      } catch (err) {
        console.warn("Failed to send subscribe_user on open:", err);
      }

      // 2. Re-join active boards and notify subscribers
      for (const subscriber of this.subscribers.values()) {
        try {
          ws.send(JSON.stringify({ action: "join", boardId: subscriber.boardId }));
          subscriber.onReconnect?.();
        } catch (err) {
          console.warn(`Failed to re-join board ${subscriber.boardId} on open:`, err);
        }
      }

      // 3. Setup heartbeat ping interval every 25 seconds
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ action: "ping" }));
          } catch {}
        }
      }, 25000);
    };

    ws.onmessage = evt => {
      if (this.socket !== ws) return;
      try {
        const data = typeof evt.data === "string" ? JSON.parse(evt.data) : evt.data;
        this.handleMessageData(data);
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    };

    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.setStatus("disconnected");
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Do NOT reconnect if user logged out
      if (!this.token) {
        return;
      }

      // Exponential backoff reconnect: 1s, 2s, 4s, 8s, up to 10s max
      const delay = Math.min(1000 * 2 ** this.retryCount, 10000);
      this.retryCount += 1;
      this.setStatus("reconnecting");
      this.reconnectTimeout = setTimeout(() => {
        if (!this.token) return;
        this.connect();
      }, delay);
    };

    ws.onerror = err => {
      if (this.socket !== ws) return;
      console.warn("WebSocket error:", err);
      this.setStatus("disconnected");
      try {
        ws.close();
      } catch {}
    };
  }

  public disconnect() {
    this.token = null;
    this.currentUser = null;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.setStatus("disconnected");
  }

  public send(data: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const msg = typeof data === "string" ? data : JSON.stringify(data);
      this.socket.send(msg);
      return true;
    } catch (err) {
      console.warn("Failed to send websocket message:", err);
      return false;
    }
  }

  public registerBoardSubscriber(
    boardId: string,
    callbacks: {
      onEvent: (event: IncomingSocketEvent) => void;
      onReconnect?: () => void;
    }
  ): () => void {
    this.subscribers.set(boardId, { boardId, ...callbacks });

    // If socket is open right now, join the board immediately
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ action: "join", boardId }));
      } catch (err) {
        console.warn(`Failed to send join for board ${boardId}:`, err);
      }
    }

    return () => {
      this.subscribers.delete(boardId);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ action: "leave", boardId }));
        } catch (err) {
          console.warn(`Failed to send leave for board ${boardId}:`, err);
        }
      }
    };
  }

  public handleMessageData(data: any) {
    if (!data) return;

    // Handle heartbeat ping / pong
    if (data.action === "ping" || data.type === "ping") {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ action: "pong" }));
        } catch {}
      }
      return;
    }
    if (data.action === "pong" || data.type === "pong") {
      return;
    }

    if (data.type === "user_subscribed") {
      return;
    }

    const eventType = data.type || data.eventType;

    // Route user-level events
    if (
      eventType === "user:notification" ||
      (typeof eventType === "string" && eventType.startsWith("user:org_"))
    ) {
      this.handleUserEvent(data);
      return;
    }

    // Route board-level events to registered board subscribers
    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.onEvent(data);
      } catch (err) {
        console.error(`Error in board subscriber for board ${subscriber.boardId}:`, err);
      }
    }
  }

  public handleUserEvent(data: any) {
    if (!data) return;
    const eventType = data.type || data.eventType;
    const payload = data.payload ?? data;

    const extractOrgId = (p: any): string | null => {
      if (!p || typeof p !== "object") return null;
      return (
        p.orgId ||
        p.data?.orgId ||
        p.notification?.data?.orgId ||
        p.org?.id ||
        null
      );
    };

    const extractRole = (p: any): OrgRole | null => {
      if (!p || typeof p !== "object") return null;
      const role =
        p.role ||
        p.newRole ||
        p.data?.role ||
        p.data?.newRole ||
        p.notification?.data?.role ||
        p.notification?.data?.newRole;
      if (role === "admin" || role === "employee" || role === "contributor") {
        return role;
      }
      return null;
    };

    const handleOrgInvitation = (p: any) => {
      const orgId = extractOrgId(p);
      if (!orgId) return;

      const role = extractRole(p) || "contributor";
      const orgName =
        p.orgName ||
        p.data?.orgName ||
        p.notification?.data?.orgName ||
        p.org?.name ||
        "Organization";
      const orgDesc =
        p.orgDescription ||
        p.data?.orgDescription ||
        p.notification?.data?.orgDescription ||
        p.org?.description ||
        "";

      const membership: UserOrgMembership = p.membership || {
        id: p.id || p.membershipId || `m-pending-${orgId}`,
        role,
        accepted: false,
        userId: this.currentUser?.id || p.userId || "",
        orgId,
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: p.updatedAt || new Date().toISOString(),
        acceptedAt: null,
        org: p.org || {
          id: orgId,
          name: orgName,
          description: orgDesc,
          visible: p.visible ?? p.org?.visible ?? true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };

      useOrgStore.getState().addOrUpdateMembership(membership);
      this.queryClient?.invalidateQueries({ queryKey: ["memberships"] });
    };

    const handleOrgRole = (p: any) => {
      const orgId = extractOrgId(p);
      const role = extractRole(p);
      if (orgId && role) {
        useOrgStore.getState().updateMembershipRole(orgId, role);
        this.queryClient?.invalidateQueries({ queryKey: ["orgMembers", orgId] });
      }
    };

    const handleOrgRemoval = (p: any) => {
      const orgId = extractOrgId(p);
      if (orgId) {
        useOrgStore.getState().removeMembership(orgId);
        this.queryClient?.invalidateQueries({ queryKey: ["boards", orgId] });
        this.queryClient?.invalidateQueries({ queryKey: ["orgMembers", orgId] });
      }
    };

    const handleOrgAcceptance = (p: any) => {
      const orgId = extractOrgId(p);
      if (orgId) {
        this.queryClient?.invalidateQueries({ queryKey: ["orgMembers", orgId] });
      }
    };

    const handleOrgMembershipUpdated = (p: any) => {
      if (p.membership) {
        useOrgStore.getState().addOrUpdateMembership(p.membership);
      } else {
        useOrgStore.getState().loadOrgs().catch(() => {});
      }
    };

    if (eventType === "user:notification") {
      const notif = payload?.notification;
      if (notif?.type) {
        if (notif.type === "org:invitation_received") {
          handleOrgInvitation(notif.data ?? payload);
        } else if (notif.type === "org:role_changed") {
          handleOrgRole(notif.data ?? payload);
        } else if (notif.type === "org:member_removed") {
          handleOrgRemoval(notif.data ?? payload);
        } else if (notif.type === "org:invitation_accepted") {
          handleOrgAcceptance(notif.data ?? payload);
        }
      }
      return;
    }

    if (eventType === "user:org_invitation_received") {
      handleOrgInvitation(payload);
    } else if (eventType === "user:org_role_changed") {
      handleOrgRole(payload);
    } else if (eventType === "user:org_member_removed") {
      handleOrgRemoval(payload);
    } else if (eventType === "user:org_invitation_accepted") {
      handleOrgAcceptance(payload);
    } else if (eventType === "user:org_membership_updated") {
      handleOrgMembershipUpdated(payload);
    } else if (eventType === "user:org_board_created") {
      const orgId = payload?.orgId || extractOrgId(payload);
      const board = payload?.board || payload?.data?.board;
      if (orgId && board && board.id) {
        const activeOrgId = useOrgStore.getState().activeOrgId;
        this.queryClient?.setQueryData<BoardSummary[]>(["boards", orgId], old => {
          if (!old && orgId !== activeOrgId) {
            return undefined;
          }
          return applyDashboardBoardCreated(old, board);
        });
      }
    } else if (eventType === "user:org_board_deleted") {
      const orgId = payload?.orgId || extractOrgId(payload);
      const boardId = payload?.boardId || payload?.data?.boardId;
      if (orgId && boardId) {
        this.queryClient?.setQueryData<BoardSummary[]>(["boards", orgId], old => {
          if (!old) return old;
          return applyDashboardBoardDeleted(old, boardId);
        });
        this.queryClient?.removeQueries({ queryKey: ["board", boardId] });
      }
    } else if (eventType === "user:org_board_columns_changed") {
      const orgId = payload?.orgId || extractOrgId(payload);
      const boardId = payload?.boardId || payload?.data?.boardId;
      const columnCount =
        typeof payload?.columnCount === "number"
          ? payload.columnCount
          : typeof payload?.data?.columnCount === "number"
          ? payload.data.columnCount
          : undefined;

      if (orgId && boardId && columnCount !== undefined) {
        this.queryClient?.setQueryData<BoardSummary[]>(["boards", orgId], old => {
          if (!old) return old;
          return applyDashboardColumnsChanged(old, boardId, columnCount);
        });
      }
    } else if (eventType === "user:org_board_cards_changed") {
      const orgId = payload?.orgId || extractOrgId(payload);
      const boardId = payload?.boardId || payload?.data?.boardId;
      const cardCount =
        typeof payload?.cardCount === "number"
          ? payload.cardCount
          : typeof payload?.data?.cardCount === "number"
          ? payload.data.cardCount
          : undefined;

      if (orgId && boardId && cardCount !== undefined) {
        this.queryClient?.setQueryData<BoardSummary[]>(["boards", orgId], old => {
          if (!old) return old;
          return applyDashboardCardCountChanged(old, boardId, cardCount);
        });
      }
    } else if (eventType === "user:org_board_updated") {
      const orgId = payload?.orgId || extractOrgId(payload);
      const boardId = payload?.boardId || payload?.data?.boardId;
      const changes = payload?.changes || payload?.board || payload?.data?.changes || payload?.data?.board || payload;

      if (orgId && boardId) {
        this.queryClient?.setQueryData<BoardSummary[]>(["boards", orgId], old => {
          if (!old) return old;
          return applyDashboardBoardUpdated(old, boardId, changes);
        });
      }
    }
  }
}

// ============================================================================
// Fine-Grained Dashboard Reducer Helpers
// ============================================================================

export function applyDashboardBoardCreated(
  boards: BoardSummary[] | undefined,
  newBoard: BoardSummary
): BoardSummary[] {
  const normalized: BoardSummary = {
    ...newBoard,
    _count: {
      issues: newBoard._count?.issues ?? newBoard.cardCount ?? 0,
      section: newBoard._count?.section ?? newBoard.columnCount ?? 0
    },
    columnCount: newBoard.columnCount ?? newBoard._count?.section ?? 0,
    cardCount: newBoard.cardCount ?? newBoard._count?.issues ?? 0
  };
  if (!boards) return [normalized];
  if (boards.some(b => b.id === normalized.id)) {
    return boards.map(b => (b.id === normalized.id ? { ...b, ...normalized } : b));
  }
  return [...boards, normalized];
}

export function applyDashboardBoardDeleted(
  boards: BoardSummary[] | undefined,
  boardId: string
): BoardSummary[] | undefined {
  if (!boards) return undefined;
  return boards.filter(b => b.id !== boardId);
}

export function applyDashboardColumnsChanged(
  boards: BoardSummary[] | undefined,
  boardId: string,
  columnCount: number
): BoardSummary[] | undefined {
  if (!boards) return undefined;
  return boards.map(b => {
    if (b.id !== boardId) return b;
    return {
      ...b,
      columnCount,
      cardCount: b.cardCount ?? b._count?.issues ?? 0,
      _count: {
        ...b._count,
        issues: b._count?.issues ?? b.cardCount ?? 0,
        section: columnCount
      }
    };
  });
}

export function applyDashboardCardCountChanged(
  boards: BoardSummary[] | undefined,
  boardId: string,
  cardCount: number
): BoardSummary[] | undefined {
  if (!boards) return undefined;
  return boards.map(b => {
    if (b.id !== boardId) return b;
    return {
      ...b,
      cardCount,
      columnCount: b.columnCount ?? b._count?.section ?? 0,
      _count: {
        ...b._count,
        issues: cardCount,
        section: b._count?.section ?? b.columnCount ?? 0
      }
    };
  });
}

export function applyDashboardBoardUpdated(
  boards: BoardSummary[] | undefined,
  boardId: string,
  changes: Partial<BoardSummary> | Record<string, any>
): BoardSummary[] | undefined {
  if (!boards) return undefined;
  return boards.map(b => {
    if (b.id !== boardId) return b;
    const updatedTitle = changes.title !== undefined ? changes.title : b.title;
    const updatedDescription = changes.description !== undefined ? changes.description : b.description;
    const updatedColor = changes.color !== undefined ? changes.color : b.color;
    const updatedIsArchived = changes.isArchived !== undefined ? Boolean(changes.isArchived) : b.isArchived;

    return {
      ...b,
      ...changes,
      title: updatedTitle,
      description: updatedDescription,
      color: updatedColor,
      isArchived: updatedIsArchived,
      columnCount: b.columnCount ?? b._count?.section ?? 0,
      cardCount: b.cardCount ?? b._count?.issues ?? 0,
      _count: {
        ...b._count,
        issues: b._count?.issues ?? b.cardCount ?? 0,
        section: b._count?.section ?? b.columnCount ?? 0,
        ...(changes._count || {})
      }
    };
  });
}

// Global default instance for the application
let defaultManager: AppSocketManager | null = null;

export function getAppSocketManager(): AppSocketManager {
  if (!defaultManager) {
    defaultManager = new AppSocketManager();
  }
  return defaultManager;
}

export function resetAppSocketManager(): void {
  if (defaultManager) {
    defaultManager.disconnect();
    defaultManager = null;
  }
}

// ============================================================================
// useAppSocket Hook
// ============================================================================

export function useAppSocket(options?: UseAppSocketOptions): AppSocketContextValue {
  const manager = options?.manager || getAppSocketManager();

  const authStoreToken = useAuthStore(s => s.token);
  const authStoreUser = useAuthStore(s => s.user);

  const token = options?.token !== undefined ? options.token : authStoreToken;
  const currentUser = options?.currentUser !== undefined ? options.currentUser : authStoreUser;

  try {
    const qc = useQueryClient();
    manager.setQueryClient(qc);
  } catch {
    // Graceful fallback for headless/SSR test contexts
  }

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    manager.getConnectionStatus()
  );

  useEffect(() => {
    const unsubscribeStatus = manager.onStatusChange(status => {
      setConnectionStatus(status);
      useBoardStore.getState().setConnectionStatus(status);
    });

    if (token) {
      manager.connect(token, currentUser);
    } else {
      manager.disconnect();
    }

    return () => {
      unsubscribeStatus();
    };
  }, [token, currentUser, manager]);

  return {
    socket: manager.getSocket(),
    isConnected: connectionStatus === "connected",
    connectionStatus,
    send: (data: unknown) => manager.send(data),
    registerBoardSubscriber: (boardId, callbacks) =>
      manager.registerBoardSubscriber(boardId, callbacks),
    handleIncomingEvent: (data: unknown) => manager.handleMessageData(data)
  };
}
