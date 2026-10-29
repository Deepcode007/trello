import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import {
  AppSocketManager,
  getAppSocketManager,
  resetAppSocketManager
} from "../hooks/useAppSocket";
import { useBoardSocket } from "../hooks/useBoardSocket";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import type { UserOrgMembership } from "../lib/org-api";
import type { NotificationsPageResponse } from "../lib/notification-api";
import { api } from "../lib/api";
import { clearToasts } from "../components/ui/toast";

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

  simulateError(err: unknown) {
    if (this.onerror) this.onerror(err);
  }
}

const originalWebSocket = globalThis.WebSocket;

describe("Phase 4: Frontend App-Level Multiplexed WebSocket Suite", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();
    const internals = (React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
        H?: { useSyncExternalStore?: (sub: unknown, snap: () => unknown) => unknown };
      };
    }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (internals?.H) {
      internals.H.useSyncExternalStore = (_sub, snap) => snap();
    }

    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    MockWebSocket.reset();
    resetAppSocketManager();

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    useOrgStore.getState().resetOrgState();
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({
      token: "test-auth-token-123",
      user: {
        id: "usr-active-1",
        email: "alice@example.com",
        username: "alice"
      }
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    resetAppSocketManager();
    useOrgStore.getState().resetOrgState();
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({ token: null, user: null });
  });

  // ==========================================================================
  // Blueprint Required Tests: Org Event Cache Updates
  // ==========================================================================

  describe("Org event cache updates (Blueprint Core Requirements)", () => {
    const initialMembership: UserOrgMembership = {
      id: "m-1",
      role: "admin",
      accepted: true,
      userId: "usr-active-1",
      orgId: "org-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-01T00:00:00Z",
      org: {
        id: "org-1",
        name: "Acme Corp",
        description: "Primary Org",
        visible: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      }
    };

    it("1. user:org_invitation_received updates org store memberships", () => {
      useOrgStore.setState({
        memberships: [initialMembership],
        activeOrgId: "org-1"
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      // Dispatch invitation event
      ws.simulateMessage({
        type: "user:org_invitation_received",
        payload: {
          orgId: "org-2",
          orgName: "Beta Labs",
          role: "employee",
          invitedBy: "usr-admin-9"
        }
      });

      const state = useOrgStore.getState();
      expect(state.memberships.length).toBe(2);

      const pending = state.getPendingInvites();
      expect(pending.length).toBe(1);
      expect(pending[0]?.orgId).toBe("org-2");
      expect(pending[0]?.org.name).toBe("Beta Labs");
      expect(pending[0]?.role).toBe("employee");
      expect(pending[0]?.accepted).toBe(false);
    });

    it("2. user:org_role_changed updates role in org store", () => {
      useOrgStore.setState({
        memberships: [initialMembership],
        activeOrgId: "org-1"
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(useOrgStore.getState().memberships[0]?.role).toBe("admin");

      // Dispatch role change event
      ws.simulateMessage({
        type: "user:org_role_changed",
        payload: {
          orgId: "org-1",
          role: "employee",
          changedBy: "usr-super-admin"
        }
      });

      const state = useOrgStore.getState();
      expect(state.memberships[0]?.role).toBe("employee");
      expect(state.getActiveMembership()?.role).toBe("employee");
    });

    it("3. user:org_member_removed removes org from memberships", () => {
      const secondMembership: UserOrgMembership = {
        id: "m-2",
        role: "employee",
        accepted: true,
        userId: "usr-active-1",
        orgId: "org-2",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        acceptedAt: "2026-01-02T00:00:00Z",
        org: {
          id: "org-2",
          name: "Beta Labs",
          description: "Second Org",
          visible: true,
          createdAt: "2026-01-02T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z"
        }
      };

      useOrgStore.setState({
        memberships: [initialMembership, secondMembership],
        activeOrgId: "org-1"
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(useOrgStore.getState().memberships.length).toBe(2);

      // Remove org-2
      ws.simulateMessage({
        type: "user:org_member_removed",
        payload: { orgId: "org-2" }
      });

      const state = useOrgStore.getState();
      expect(state.memberships.length).toBe(1);
      expect(state.memberships[0]?.orgId).toBe("org-1");
      expect(state.activeOrgId).toBe("org-1");
    });

    it("4. user:org_member_removed clears activeOrgId if it was the removed organization", () => {
      useOrgStore.setState({
        memberships: [initialMembership],
        activeOrgId: "org-1"
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(useOrgStore.getState().activeOrgId).toBe("org-1");

      // Remove org-1 (the currently active organization)
      ws.simulateMessage({
        type: "user:org_member_removed",
        payload: { orgId: "org-1" }
      });

      const state = useOrgStore.getState();
      expect(state.memberships.length).toBe(0);
      expect(state.activeOrgId).toBeNull();
      expect(state.getActiveOrg()).toBeNull();
    });

    it("routes user:notification events with org payload into org store handlers", () => {
      useOrgStore.setState({
        memberships: [initialMembership],
        activeOrgId: "org-1"
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      // Receive notification event wrapped from backend Phase 2 format
      ws.simulateMessage({
        type: "user:notification",
        payload: {
          notification: {
            type: "org:role_changed",
            data: {
              orgId: "org-1",
              role: "contributor"
            },
            createdAt: new Date().toISOString()
          }
        }
      });

      expect(useOrgStore.getState().memberships[0]?.role).toBe("contributor");
    });

    it("updates notification list and unread count caches on user:notification event", () => {
      queryClient.setQueryData(["notifications", "unread-count"], 0);
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(["notifications"], {
        pageParams: [undefined],
        pages: [
          {
            notifications: [],
            nextCursor: null
          }
        ]
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      ws.simulateMessage({
        type: "user:notification",
        payload: {
          notification: {
            id: "notif-realtime-1",
            type: "card:assigned",
            data: { cardTitle: "Critical Bug", assignedByName: "Bob" },
            createdAt: new Date().toISOString()
          }
        }
      });

      // Assert unread count incremented
      expect(queryClient.getQueryData(["notifications", "unread-count"])).toBe(1);

      // Assert notification prepended to list cache
      const cached = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>([
        "notifications"
      ]);
      expect(cached?.pages[0]?.notifications?.length).toBe(1);
      expect(cached?.pages[0]?.notifications[0]?.id).toBe("notif-realtime-1");
      expect(cached?.pages[0]?.notifications[0]?.read).toBe(false);
    });

    it("idempotently ignores duplicate user:notification events without double-counting", () => {
      queryClient.setQueryData(["notifications", "unread-count"], 0);
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(["notifications"], {
        pageParams: [undefined],
        pages: [
          {
            notifications: [],
            nextCursor: null
          }
        ]
      });

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("test-auth-token-123");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      const notifPayload = {
        type: "user:notification",
        payload: {
          notification: {
            id: "notif-dup-99",
            type: "org:role_changed",
            data: { role: "admin", orgName: "Acme" },
            createdAt: new Date().toISOString()
          }
        }
      };

      // Send first time
      ws.simulateMessage(notifPayload);
      expect(queryClient.getQueryData(["notifications", "unread-count"])).toBe(1);

      // Send duplicate
      ws.simulateMessage(notifPayload);
      // Unread count must still be 1 (not 2)
      expect(queryClient.getQueryData(["notifications", "unread-count"])).toBe(1);

      const cached = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>([
        "notifications"
      ]);
      // Must not be duplicated in list
      expect(cached?.pages[0]?.notifications?.length).toBe(1);
    });

    it("maintains exactly one WebSocket connection while delivering both board events and user notifications", () => {
      MockWebSocket.reset();
      expect(MockWebSocket.instances.length).toBe(0);

      const manager = new AppSocketManager();
      manager.setQueryClient(queryClient);
      manager.connect("valid-token");

      expect(MockWebSocket.instances.length).toBe(1);

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      // Register board subscriber
      let boardEventReceived = false;
      const unregister = manager.registerBoardSubscriber("board-1", {
        onEvent: event => {
          if (event.type === "card:moved") boardEventReceived = true;
        }
      });

      // Dispatch board event
      ws.simulateMessage({
        type: "card:moved",
        payload: { cardId: "card-1", position: 100 }
      });
      expect(boardEventReceived).toBe(true);

      // Dispatch notification event
      ws.simulateMessage({
        type: "user:notification",
        payload: {
          notification: {
            id: "notif-one-ws",
            type: "mention:comment",
            data: { authorName: "Alice" },
            createdAt: new Date().toISOString()
          }
        }
      });

      // Still strictly one WebSocket instance in use
      expect(MockWebSocket.instances.length).toBe(1);
      unregister();
    });
  });

  // ==========================================================================
  // Socket Lifecycle Tests
  // ==========================================================================

  describe("Socket Lifecycle", () => {
    it("creates exactly one socket when authenticated user connects", () => {
      expect(MockWebSocket.instances.length).toBe(0);

      const manager = new AppSocketManager();
      manager.connect("valid-token");

      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.lastInstance?.url).toContain("token=valid-token");
    });

    it("does not create a socket when user is unauthenticated (token null)", () => {
      expect(MockWebSocket.instances.length).toBe(0);

      const manager = new AppSocketManager();
      manager.connect(null);

      expect(MockWebSocket.instances.length).toBe(0);
      expect(manager.getSocket()).toBeNull();
      expect(manager.isConnected()).toBe(false);
      expect(manager.getConnectionStatus()).toBe("disconnected");
    });

    it("sends { action: 'subscribe_user' } immediately after socket opens", () => {
      const manager = new AppSocketManager();
      manager.connect("valid-token");

      const ws = MockWebSocket.lastInstance!;
      expect(ws.sentMessages).toEqual([]);

      ws.simulateOpen();

      expect(ws.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));
    });

    it("closes socket and clears timers cleanly on logout/disconnect", () => {
      const manager = new AppSocketManager();
      manager.connect("auth-token");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(ws.readyState).toBe(MockWebSocket.OPEN);
      expect(manager.isConnected()).toBe(true);

      manager.disconnect();

      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(manager.isConnected()).toBe(false);
      expect(manager.getSocket()).toBeNull();
    });

    it("re-subscribes user topic after reconnection", () => {
      const manager = new AppSocketManager();
      manager.connect("valid-token");

      const ws1 = MockWebSocket.lastInstance!;
      ws1.simulateOpen();

      expect(ws1.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));

      // Disconnect socket 1 (simulate abnormal drop)
      ws1.simulateClose(1006, "Abnormal closure");

      // Simulate reconnect trigger
      manager.connect("valid-token");
      const ws2 = MockWebSocket.lastInstance!;
      expect(ws2).not.toBe(ws1);

      ws2.simulateOpen();
      expect(ws2.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));
    });
  });

  // ==========================================================================
  // Board Integration Tests
  // ==========================================================================

  describe("Board Integration with Shared Socket", () => {
    it("board hook does not create its own WebSocket and sends join via shared socket", () => {
      // 1. App socket connects
      const manager = new AppSocketManager();
      manager.connect("valid-token");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(MockWebSocket.instances.length).toBe(1);

      // 2. Board subscriber registers with shared socket
      const unregister = manager.registerBoardSubscriber("board-42", {
        onEvent: () => {}
      });

      // No new WebSocket was created!
      expect(MockWebSocket.instances.length).toBe(1);

      // Verified join packet was sent on existing socket
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-42" }));

      // 3. Leaving board sends leave packet
      unregister();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-42" }));
      expect(MockWebSocket.instances.length).toBe(1);
    });

    it("routes board broadcast events to registered board subscriber", () => {
      const manager = new AppSocketManager();
      manager.connect("valid-token");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      let receivedEvent: any = null;
      manager.registerBoardSubscriber("board-42", {
        onEvent: event => {
          receivedEvent = event;
        }
      });

      // Server sends card:moved event
      const cardMovedMsg = {
        type: "card:moved",
        sequence: "105",
        payload: {
          cardId: "card-99",
          destList: "sec-2",
          position: 1500
        }
      };

      ws.simulateMessage(cardMovedMsg);

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent?.type).toBe("card:moved");
      expect(receivedEvent?.payload?.cardId).toBe("card-99");
    });

    it("user topic survives when leaving a board", () => {
      const manager = new AppSocketManager();
      manager.connect("valid-token");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      // Enter board
      const unregister = manager.registerBoardSubscriber("board-42", {
        onEvent: () => {}
      });

      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-42" }));

      // Leave board
      unregister();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-42" }));

      // Socket must still be open!
      expect(ws.readyState).toBe(MockWebSocket.OPEN);

      // User events are still received and processed after leaving the board!
      useOrgStore.setState({
        memberships: [
          {
            id: "m-1",
            role: "employee",
            accepted: true,
            userId: "usr-active-1",
            orgId: "org-1",
            createdAt: "",
            updatedAt: "",
            acceptedAt: "",
            org: { id: "org-1", name: "Org", description: "", visible: true, createdAt: "", updatedAt: "" }
          }
        ]
      });

      ws.simulateMessage({
        type: "user:org_role_changed",
        payload: { orgId: "org-1", role: "admin" }
      });

      expect(useOrgStore.getState().memberships[0]?.role).toBe("admin");
    });
  });

  // ==========================================================================
  // Multi-Navigation Test: Avoid Duplicate Sockets
  // ==========================================================================

  describe("Multi-Navigation Test (Dashboard -> Board A -> Board B -> Dashboard -> Board A)", () => {
    it("maintains exactly one WebSocket across continuous navigation between dashboard and boards", () => {
      // 1. User arrives on Dashboard (App creates one app socket)
      const manager = new AppSocketManager();
      manager.connect("persistent-jwt");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      expect(MockWebSocket.instances.length).toBe(1);
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));

      // 2. User enters Board A
      const leaveBoardA = manager.registerBoardSubscriber("board-A", { onEvent: () => {} });
      expect(MockWebSocket.instances.length).toBe(1);
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-A" }));

      // 3. User navigates directly to Board B
      leaveBoardA();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-A" }));

      const leaveBoardB = manager.registerBoardSubscriber("board-B", { onEvent: () => {} });
      expect(MockWebSocket.instances.length).toBe(1);
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-B" }));

      // 4. User navigates back to Dashboard
      leaveBoardB();
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-B" }));
      expect(MockWebSocket.instances.length).toBe(1);

      // 5. User enters Board A again
      const leaveBoardAAgain = manager.registerBoardSubscriber("board-A", { onEvent: () => {} });
      expect(MockWebSocket.instances.length).toBe(1);
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-A" }));

      leaveBoardAAgain();

      // Throughout the entire lifecycle, strictly ONE physical socket was used!
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  // ==========================================================================
  // Reconnect and Catch-Up Tests
  // ==========================================================================

  describe("Reconnection & Subscription Restoration", () => {
    it("restores user subscription and re-joins active board upon reconnect", () => {
      const manager = new AppSocketManager();
      manager.connect("jwt-token-reconnect");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();

      let reconnectedCalled = false;
      manager.registerBoardSubscriber("board-active-99", {
        onEvent: () => {},
        onReconnect: () => {
          reconnectedCalled = true;
        }
      });

      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-active-99" }));

      // Simulate unexpected network drop
      ws.simulateClose(1006, "Network lost");

      // App reconnects
      manager.connect("jwt-token-reconnect");
      const ws2 = MockWebSocket.lastInstance!;
      expect(ws2).not.toBe(ws);

      ws2.simulateOpen();

      // Sent messages on reconnected socket must include both subscribe_user and join for active board
      expect(ws2.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));
      expect(ws2.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-active-99" }));
      expect(reconnectedCalled).toBe(true);
    });

    it("executes catch-up synchronization via REST API when board sequence exists", async () => {
      let eventsFetched = false;
      const originalApiGet = api.get;

      api.get = mock((url: string) => {
        if (url.includes("/events?sinceSeq=50")) {
          eventsFetched = true;
          return Promise.resolve({
            data: {
              success: true,
              data: [
                {
                  sequence: "51",
                  type: "card:updated",
                  payload: { cardId: "card-1", updates: { title: "Caught Up Title" } }
                }
              ]
            }
          });
        }
        return Promise.resolve({ data: { success: true, data: [] } });
      }) as unknown as typeof api.get;

      try {
        let boardSocket: any;
        function CatchUpHarness() {
          boardSocket = useBoardSocket("board-catchup-1");
          return null;
        }
        renderToStaticMarkup(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(CatchUpHarness)
          )
        );

        await boardSocket.syncMissedEvents("board-catchup-1", "50");

        expect(eventsFetched).toBe(true);
      } finally {
        api.get = originalApiGet;
      }
    });

    it("handles connection timing race: board registers while socket is still connecting", () => {
      // 1. App socket created but STILL CONNECTING (open not yet fired)
      const manager = new AppSocketManager();
      manager.connect("jwt-race-test");

      const ws = MockWebSocket.lastInstance!;
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING);

      // 2. Board component mounts while socket is CONNECTING
      manager.registerBoardSubscriber("board-race-1", { onEvent: () => {} });

      // Join is queued and sent as soon as open fires
      ws.simulateOpen();

      expect(ws.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));
      expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-race-1" }));
    });
  });
});
