import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AppSocketManager,
  getAppSocketManager,
  resetAppSocketManager,
  applyDashboardBoardCreated,
  applyDashboardBoardDeleted,
  applyDashboardColumnsChanged,
  applyDashboardCardCountChanged,
  applyDashboardBoardUpdated
} from "../hooks/useAppSocket";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import type { BoardSummary } from "../lib/board-api";

// Mock WebSocket class for testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.lastInstance = this;
  }

  static instances: MockWebSocket[] = [];
  static lastInstance: MockWebSocket | null = null;

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === "string" ? data : JSON.stringify(data) });
    }
  }

  simulateClose(code = 1000, reason = "Normal Closure") {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }
}

const originalWebSocket = globalThis.WebSocket;

describe("Dashboard Realtime Synchronization & Live Column Counts Suite", () => {
  let queryClient: QueryClient;
  let manager: AppSocketManager;

  const sampleBoard1: BoardSummary = {
    id: "board-1",
    title: "Engineering Roadmap",
    description: "Core roadmap",
    color: "#3b82f6",
    isArchived: false,
    orgId: "org-alpha",
    _count: { issues: 5, section: 3 },
    columnCount: 3
  };

  const sampleBoard2: BoardSummary = {
    id: "board-2",
    title: "Marketing Campaign",
    description: "Q3 releases",
    color: "#10b981",
    isArchived: false,
    orgId: "org-alpha",
    _count: { issues: 2, section: 2 },
    columnCount: 2
  };

  const newBoardAlpha: BoardSummary = {
    id: "board-3",
    title: "Design System",
    description: "UI Components",
    color: "#8b5cf6",
    isArchived: false,
    orgId: "org-alpha",
    _count: { issues: 0, section: 0 },
    columnCount: 0
  };

  beforeEach(() => {
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    MockWebSocket.reset();
    resetAppSocketManager();

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    useOrgStore.getState().resetOrgState();
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({
      token: "jwt-test-user-token",
      user: {
        id: "usr-active-1",
        email: "user@example.com",
        username: "testuser"
      }
    });

    useOrgStore.setState({ activeOrgId: "org-alpha" });

    manager = new AppSocketManager();
    manager.setQueryClient(queryClient);
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    resetAppSocketManager();
    useOrgStore.getState().resetOrgState();
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({ token: null, user: null });
  });

  // ==========================================================================
  // 1. Board Creation
  // ==========================================================================

  describe("Board Creation Realtime Synchronization", () => {
    it("1. user:org_board_created adds board to ['boards', orgId]", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      manager.handleMessageData({
        type: "user:org_board_created",
        payload: {
          orgId: "org-alpha",
          board: newBoardAlpha
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached).toBeDefined();
      expect(cached?.length).toBe(3);
      expect(cached?.some(b => b.id === "board-3")).toBe(true);
      expect(cached?.[2]?.title).toBe("Design System");
      expect(cached?.[2]?.columnCount).toBe(0);
      expect(cached?.[2]?._count?.section).toBe(0);
    });

    it("2. Duplicate board-created event does not duplicate the board", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      // First event
      manager.handleMessageData({
        type: "user:org_board_created",
        payload: {
          orgId: "org-alpha",
          board: newBoardAlpha
        }
      });

      // Second identical event
      manager.handleMessageData({
        type: "user:org_board_created",
        payload: {
          orgId: "org-alpha",
          board: newBoardAlpha
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached).toBeDefined();
      expect(cached?.length).toBe(2);
      const matches = cached?.filter(b => b.id === "board-3");
      expect(matches?.length).toBe(1);
    });

    it("3. Event for another org does not modify current org's board list", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      const boardBeta: BoardSummary = {
        id: "board-beta-1",
        title: "Beta Board",
        description: "Another Org",
        color: "#ef4444",
        isArchived: false,
        orgId: "org-beta",
        _count: { issues: 0, section: 0 },
        columnCount: 0
      };

      // Event arrives for org-beta while activeOrgId is org-alpha
      manager.handleMessageData({
        type: "user:org_board_created",
        payload: {
          orgId: "org-beta",
          board: boardBeta
        }
      });

      // Active org-alpha must remain strictly untouched
      const currentOrgBoards = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(currentOrgBoards?.length).toBe(2);
      expect(currentOrgBoards?.some(b => b.id === "board-beta-1")).toBe(false);
    });

    it("4. Board creation works while user is on dashboard", () => {
      manager.connect("token-active");
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(ws.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));

      // User sitting on dashboard with cached boards
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      // Live incoming WebSocket message arrives on user topic
      ws.simulateMessage({
        type: "user:org_board_created",
        payload: {
          orgId: "org-alpha",
          board: newBoardAlpha
        }
      });

      const updated = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(updated?.length).toBe(2);
      expect(updated?.find(b => b.id === "board-3")?.title).toBe("Design System");
    });

    it("5. Board creation works while navigating Dashboard → Board → Dashboard", () => {
      manager.connect("token-nav");
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      // Step 1: On dashboard
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      // Step 2: Navigate to Board 1 (register board subscriber)
      const unregister = manager.registerBoardSubscriber("board-1", {
        onEvent: () => {}
      });
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-1" }));

      // While on board page, someone creates a new board in org-alpha
      ws.simulateMessage({
        type: "user:org_board_created",
        payload: {
          orgId: "org-alpha",
          board: newBoardAlpha
        }
      });

      // Step 3: Navigate back to Dashboard (leave board)
      unregister();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-1" }));

      // Dashboard board cache must already have the new board
      const finalCache = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(finalCache?.length).toBe(2);
      expect(finalCache?.some(b => b.id === "board-3")).toBe(true);

      // Verify exactly ONE socket was maintained throughout
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  // ==========================================================================
  // 2. Board Deletion
  // ==========================================================================

  describe("Board Deletion Realtime Synchronization", () => {
    it("6. user:org_board_deleted removes board from ['boards', orgId]", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      manager.handleMessageData({
        type: "user:org_board_deleted",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1"
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached).toBeDefined();
      expect(cached?.length).toBe(1);
      expect(cached?.[0]?.id).toBe("board-2");
      expect(cached?.some(b => b.id === "board-1")).toBe(false);
    });

    it("7. Deleting an already-removed board is harmless", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard2]);

      expect(() => {
        manager.handleMessageData({
          type: "user:org_board_deleted",
          payload: {
            orgId: "org-alpha",
            boardId: "board-1" // already not in list
          }
        });
      }).not.toThrow();

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.length).toBe(1);
      expect(cached?.[0]?.id).toBe("board-2");
    });

    it("8. Event for another org does not modify current board list", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      manager.handleMessageData({
        type: "user:org_board_deleted",
        payload: {
          orgId: "org-beta",
          boardId: "board-1" // matching id but different org
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.length).toBe(2);
      expect(cached?.some(b => b.id === "board-1")).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Column Count Live Updates
  // ==========================================================================

  describe("Column Count Live Realtime Updates", () => {
    it("9. user:org_board_columns_changed updates the correct board's column count", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          columnCount: 4
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      const updatedBoard1 = cached?.find(b => b.id === "board-1");
      const untouchedBoard2 = cached?.find(b => b.id === "board-2");

      expect(updatedBoard1?.columnCount).toBe(4);
      expect(updatedBoard1?._count?.section).toBe(4);
      expect(updatedBoard1?._count?.issues).toBe(5); // Preserved issue count

      expect(untouchedBoard2?.columnCount).toBe(2);
      expect(untouchedBoard2?._count?.section).toBe(2);
    });

    it("10. Column count event for another org is ignored", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: {
          orgId: "org-gamma",
          boardId: "board-1",
          columnCount: 10
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.columnCount).toBe(3);
    });

    it("11. Duplicate column count event is harmless", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      // Emit column count 5 twice
      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          columnCount: 5
        }
      });
      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          columnCount: 5
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.columnCount).toBe(5);
    });

    it("12. Multiple rapid column-count events leave the cache at the latest authoritative count", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      // Rapid column creations and deletions
      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: { orgId: "org-alpha", boardId: "board-1", columnCount: 4 }
      });
      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: { orgId: "org-alpha", boardId: "board-1", columnCount: 5 }
      });
      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: { orgId: "org-alpha", boardId: "board-1", columnCount: 3 }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.columnCount).toBe(3);
      expect(cached?.[0]?._count?.section).toBe(3);
    });
  });

  // ==========================================================================
  // 4. Shared Socket Architecture Invariants
  // ==========================================================================

  describe("Shared Socket Architecture Invariants", () => {
    it("13. No additional WebSocket is created for dashboard synchronization", () => {
      manager.connect("token-single-socket");
      expect(MockWebSocket.instances.length).toBe(1);

      // Multiple board actions and events occur
      manager.handleMessageData({
        type: "user:org_board_created",
        payload: { orgId: "org-alpha", board: newBoardAlpha }
      });
      manager.handleMessageData({
        type: "user:org_board_columns_changed",
        payload: { orgId: "org-alpha", boardId: "board-3", columnCount: 2 }
      });

      // Still exactly one WebSocket instance exists
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it("14. Existing single-socket navigation test still passes", () => {
      manager.connect("token-persistent");
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      // Dashboard
      expect(manager.isConnected()).toBe(true);

      // Join Board A
      const unsubA = manager.registerBoardSubscriber("board-A", { onEvent: () => {} });
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-A" }));

      // Navigate to Board B
      unsubA();
      const unsubB = manager.registerBoardSubscriber("board-B", { onEvent: () => {} });
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-A" }));
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-B" }));

      // Navigate back to Dashboard
      unsubB();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-B" }));

      // WebSocket instance was never re-created
      expect(MockWebSocket.instances.length).toBe(1);
      expect(ws.readyState).toBe(MockWebSocket.OPEN);
    });

    it("15. User subscription remains active while leaving a board", () => {
      manager.connect("token-stay-subscribed");
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(ws.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));

      // Join board
      const unsub = manager.registerBoardSubscriber("board-leave-test", { onEvent: () => {} });
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-leave-test" }));

      // Leave board
      unsub();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-leave-test" }));

      // User topic event is delivered and processed after leaving the board
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      ws.simulateMessage({
        type: "user:org_board_columns_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          columnCount: 9
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.columnCount).toBe(9);
    });
  });

  // ==========================================================================
  // 5. Card Count Live Realtime Updates
  // ==========================================================================

  describe("Card Count Live Realtime Updates", () => {
    it("16. user:org_board_cards_changed updates card count and _count.issues for the correct board", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      manager.handleMessageData({
        type: "user:org_board_cards_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          cardCount: 15
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      const updatedBoard1 = cached?.find(b => b.id === "board-1");
      const untouchedBoard2 = cached?.find(b => b.id === "board-2");

      expect(updatedBoard1?.cardCount).toBe(15);
      expect(updatedBoard1?._count?.issues).toBe(15);
      // Column count is preserved intact
      expect(updatedBoard1?.columnCount).toBe(3);
      expect(updatedBoard1?._count?.section).toBe(3);

      // Other board remains untouched
      expect(untouchedBoard2?.cardCount).toBeUndefined();
      expect(untouchedBoard2?._count?.issues).toBe(2);
    });

    it("17. Authoritative count is used (no drift from incremental updates)", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      // Server emits authoritative count of 10
      manager.handleMessageData({
        type: "user:org_board_cards_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          cardCount: 10
        }
      });

      // Subsequent server emits authoritative count of 8 (e.g. 2 deleted concurrently)
      manager.handleMessageData({
        type: "user:org_board_cards_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          cardCount: 8
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.cardCount).toBe(8);
      expect(cached?.[0]?._count?.issues).toBe(8);
    });

    it("18. Duplicate card count event is idempotent", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      manager.handleMessageData({
        type: "user:org_board_cards_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          cardCount: 7
        }
      });
      manager.handleMessageData({
        type: "user:org_board_cards_changed",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          cardCount: 7
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.cardCount).toBe(7);
      expect(cached?.[0]?._count?.issues).toBe(7);
    });

    it("19. Card count event for another org is ignored", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      manager.handleMessageData({
        type: "user:org_board_cards_changed",
        payload: {
          orgId: "org-beta",
          boardId: "board-1",
          cardCount: 99
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.cardCount).toBeUndefined();
      expect(cached?.[0]?._count?.issues).toBe(5);
    });

    it("20. Missing board in cache is handled safely without throwing", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      expect(() => {
        manager.handleMessageData({
          type: "user:org_board_cards_changed",
          payload: {
            orgId: "org-alpha",
            boardId: "non-existent-board",
            cardCount: 10
          }
        });
      }).not.toThrow();

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.length).toBe(1);
      expect(cached?.[0]?.id).toBe("board-1");
    });
  });

  // ==========================================================================
  // 6. Board Archive/Unarchive & Metadata Realtime Updates
  // ==========================================================================

  describe("Board Archive/Unarchive & Metadata Realtime Updates", () => {
    it("21. Archiving a board updates isArchived to true in ['boards', orgId]", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1, sampleBoard2]);

      manager.handleMessageData({
        type: "user:org_board_updated",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          changes: {
            isArchived: true
          }
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      const updatedBoard1 = cached?.find(b => b.id === "board-1");
      const untouchedBoard2 = cached?.find(b => b.id === "board-2");

      expect(updatedBoard1?.isArchived).toBe(true);
      // Preserves card and column counts!
      expect(updatedBoard1?.columnCount).toBe(3);
      expect(updatedBoard1?._count?.issues).toBe(5);
      expect(updatedBoard1?._count?.section).toBe(3);

      expect(untouchedBoard2?.isArchived).toBe(false);
    });

    it("22. Unarchiving a board updates isArchived to false in ['boards', orgId]", () => {
      const archivedBoard: BoardSummary = { ...sampleBoard1, isArchived: true };
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [archivedBoard]);

      manager.handleMessageData({
        type: "user:org_board_updated",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          changes: {
            isArchived: false
          }
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.isArchived).toBe(false);
    });

    it("23. Board title and color updates reflect in dashboard cache", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      manager.handleMessageData({
        type: "user:org_board_updated",
        payload: {
          orgId: "org-alpha",
          boardId: "board-1",
          changes: {
            title: "Renamed Engineering Roadmap",
            color: "#f59e0b"
          }
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.title).toBe("Renamed Engineering Roadmap");
      expect(cached?.[0]?.color).toBe("#f59e0b");
      expect(cached?.[0]?.columnCount).toBe(3);
      expect(cached?.[0]?._count?.issues).toBe(5);
    });

    it("24. Board update event for another org does not modify active org boards", () => {
      queryClient.setQueryData<BoardSummary[]>(["boards", "org-alpha"], [sampleBoard1]);

      manager.handleMessageData({
        type: "user:org_board_updated",
        payload: {
          orgId: "org-gamma",
          boardId: "board-1",
          changes: {
            isArchived: true
          }
        }
      });

      const cached = queryClient.getQueryData<BoardSummary[]>(["boards", "org-alpha"]);
      expect(cached?.[0]?.isArchived).toBe(false);
    });
  });

  // ==========================================================================
  // 7. Pure Reducer Unit Edge Cases
  // ==========================================================================

  describe("Pure Reducer Unit Edge Cases", () => {
    it("applyDashboardBoardCreated handles undefined initial cache by creating new array", () => {
      const result = applyDashboardBoardCreated(undefined, newBoardAlpha);
      expect(result.length).toBe(1);
      expect(result[0]?.id).toBe("board-3");
    });

    it("applyDashboardBoardDeleted handles undefined initial cache gracefully", () => {
      const result = applyDashboardBoardDeleted(undefined, "board-1");
      expect(result).toBeUndefined();
    });

    it("applyDashboardColumnsChanged handles undefined initial cache gracefully", () => {
      const result = applyDashboardColumnsChanged(undefined, "board-1", 5);
      expect(result).toBeUndefined();
    });

    it("applyDashboardCardCountChanged handles undefined initial cache gracefully", () => {
      const result = applyDashboardCardCountChanged(undefined, "board-1", 10);
      expect(result).toBeUndefined();
    });

    it("applyDashboardBoardUpdated handles undefined initial cache gracefully", () => {
      const result = applyDashboardBoardUpdated(undefined, "board-1", { isArchived: true });
      expect(result).toBeUndefined();
    });

    it("applyDashboardBoardUpdated preserves column and card counts when updating isArchived", () => {
      const initial: BoardSummary[] = [
        {
          id: "board-1",
          title: "Board 1",
          description: null,
          color: null,
          isArchived: false,
          orgId: "org-1",
          columnCount: 4,
          cardCount: 12,
          _count: { issues: 12, section: 4 }
        }
      ];

      const result = applyDashboardBoardUpdated(initial, "board-1", { isArchived: true });
      expect(result?.[0]?.isArchived).toBe(true);
      expect(result?.[0]?.columnCount).toBe(4);
      expect(result?.[0]?.cardCount).toBe(12);
      expect(result?.[0]?._count?.issues).toBe(12);
      expect(result?.[0]?._count?.section).toBe(4);
    });
  });
});
