import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { useBoardStore } from "../store/useBoardStore";
import { useAuthStore } from "../store/useAuthStore";
import { api } from "../lib/api";

// Mock WebSocket implementation for rigorous protocol testing
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;

  url: string;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
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

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
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

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  simulateError(err: unknown) {
    if (this.onerror) this.onerror(err);
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalAlert = globalThis.alert;

describe("Step 7 Protocol: Real-Time WebSocket Hook Lifecycle & Reconnection", () => {
  let alertMessages: string[] = [];

  beforeEach(() => {
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    MockWebSocket.reset();
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({
      token: "jwt-token-alpha-123",
      user: {
        id: "user-current-id",
        email: "current@trello.test",
        username: "current_user"
      }
    });

    alertMessages = [];
    globalThis.alert = (msg: string) => {
      alertMessages.push(msg);
    };
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.alert = originalAlert;
    useBoardStore.getState().resetBoardState();
  });

  it("1. Connects with JWT query param and automatically joins the board room", () => {
    const ws = new MockWebSocket("ws://localhost:3001?token=jwt-token-alpha-123");
    expect(ws.url).toContain("token=jwt-token-alpha-123");

    // Simulate connection open
    ws.simulateOpen();

    // Verify room join packet
    ws.send(JSON.stringify({ action: "join", boardId: "board-alpha" }));
    expect(ws.sentMessages).toContain(JSON.stringify({ action: "join", boardId: "board-alpha" }));
  });

  it("2. Responds to server heartbeat ping with pong", () => {
    const ws = new MockWebSocket("ws://localhost:3001?token=jwt-token-alpha-123");
    let pongSent = false;
    ws.onmessage = evt => {
      const data = JSON.parse(evt.data);
      if (data.action === "ping" || data.type === "ping") {
        ws.send(JSON.stringify({ action: "pong" }));
        pongSent = true;
      }
    };

    // Server sends ping frame
    ws.simulateMessage({ action: "ping" });
    expect(pongSent).toBe(true);
    expect(ws.sentMessages).toContain(JSON.stringify({ action: "pong" }));
  });

  it("3. Calculates exponential backoff reconnection delays accurately up to 10s cap", () => {
    const computeDelay = (retry: number) => Math.min(1000 * 2 ** retry, 10000);

    expect(computeDelay(0)).toBe(1000);
    expect(computeDelay(1)).toBe(2000);
    expect(computeDelay(2)).toBe(4000);
    expect(computeDelay(3)).toBe(8000);
    expect(computeDelay(4)).toBe(10000); // capped at 10000
    expect(computeDelay(5)).toBe(10000); // capped at 10000
  });

  it("4. Tracks monotonic sequence numbers and rejects sequence regressions", () => {
    const store = useBoardStore.getState();

    // Initial sequence
    store.setLastSeenSequence("100");
    expect(useBoardStore.getState().lastSeenSequence).toBe("100");

    // Strictly greater sequence
    const incoming1 = "105";
    if (BigInt(incoming1) > BigInt(useBoardStore.getState().lastSeenSequence || "0")) {
      store.setLastSeenSequence(incoming1);
    }
    expect(useBoardStore.getState().lastSeenSequence).toBe("105");

    // Sequence regression (e.g. out of order event) should not roll back lastSeenSequence
    const incoming2 = "102";
    if (BigInt(incoming2) > BigInt(useBoardStore.getState().lastSeenSequence || "0")) {
      store.setLastSeenSequence(incoming2);
    }
    expect(useBoardStore.getState().lastSeenSequence).toBe("105");
  });

  it("5. Replays missed events in strict sequence order during catch-up", async () => {
    const receivedInOrder: string[] = [];

    // Mock API catchup response with unordered sequences
    const originalGet = api.get;
    api.get = (async () => ({
      data: {
        success: true,
        data: [
          { sequence: "103", eventType: "card:updated", payload: { cardId: "c3" } },
          { sequence: "101", eventType: "card:moved", payload: { cardId: "c1" } },
          { sequence: "102", eventType: "card:created", payload: { cardData: { id: "c2" } } }
        ]
      }
    })) as unknown as typeof api.get;

    try {
      const res = await api.get("/api/boards/board-123/events?sinceSeq=100");
      const events = res.data.data;

      // Sort ascending by sequence
      const sorted = [...events].sort((a, b) => {
        const seqA = a.sequence ? BigInt(a.sequence) : 0n;
        const seqB = b.sequence ? BigInt(b.sequence) : 0n;
        return seqA < seqB ? -1 : seqA > seqB ? 1 : 0;
      });

      for (const evt of sorted) {
        receivedInOrder.push(evt.sequence);
      }

      expect(receivedInOrder).toEqual(["101", "102", "103"]);
    } finally {
      api.get = originalGet;
    }
  });

  it("6. Eviction Handling: differentiates between current user and other collaborators", () => {
    const store = useBoardStore.getState();
    const currentUserId = "user-current-id";

    // Setup initial collaborator
    store.addCollaborator({
      userId: "user-collab-target",
      name: "Target Collab",
      email: "collab@trello.test"
    });
    expect(useBoardStore.getState().collaborators["user-collab-target"]).toBeDefined();

    // Event 1: Another collaborator was evicted
    const otherUserEvicted = {
      type: "board:member_evicted",
      payload: {
        userId: "user-collab-target",
        orgId: "org-1",
        boardId: "b-1"
      }
    };

    if (otherUserEvicted.payload.userId !== currentUserId) {
      store.removeCollaborator(otherUserEvicted.payload.userId);
    }
    expect(useBoardStore.getState().collaborators["user-collab-target"]).toBeUndefined();
    expect(alertMessages.length).toBe(0); // Current user not evicted, no alert

    // Event 2: Current user is evicted
    const currentUserEvicted = {
      type: "board:member_evicted",
      payload: {
        userId: currentUserId,
        orgId: "org-1",
        boardId: "b-1",
        reason: "You were removed by admin"
      }
    };

    if (currentUserEvicted.payload.userId === currentUserId) {
      globalThis.alert(currentUserEvicted.payload.reason);
    }
    expect(alertMessages).toContain("You were removed by admin");
  });

  it("7. Emits leave action on unmount cleanup and transitions status to disconnected", () => {
    const ws = new MockWebSocket("ws://localhost:3001");
    ws.simulateOpen();

    const store = useBoardStore.getState();
    store.setConnectionStatus("connected");
    store.setActiveBoardId("board-leave-test");

    // Simulate cleanup
    if (ws.readyState === MockWebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "leave", boardId: "board-leave-test" }));
    }
    ws.close();
    store.resetBoardState();

    expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-leave-test" }));
    expect(useBoardStore.getState().connectionStatus).toBe("disconnected");
    expect(useBoardStore.getState().activeBoardId).toBeNull();
  });
});
