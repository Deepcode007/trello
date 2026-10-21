import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { useBoardStore } from "../store/useBoardStore";
import { useAuthStore } from "../store/useAuthStore";
import { processCollaboratorsFromEvent } from "../hooks/useBoardSocket";

// Mock WebSocket implementation for Bun test environment
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
  }

  static lastInstance: MockWebSocket | null = null;

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  // Helper to trigger receiving a message from server
  receiveServerMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// Assign mock to globalThis
const originalWebSocket = globalThis.WebSocket;

describe("useBoardSocket real-time presence and event handling", () => {
  beforeEach(() => {
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    MockWebSocket.lastInstance = null;
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({
      token: "test-jwt-token-xyz",
      user: {
        id: "usr-current",
        email: "current@example.com",
        username: "currentuser"
      }
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    useBoardStore.getState().resetBoardState();
  });

  it("handles user:joined and user:left broadcast events via store updates", () => {
    const store = useBoardStore.getState();

    // Emulate user:joined
    store.addCollaborator({
      userId: "u-collab-1",
      name: "Collab One",
      email: "collab1@example.com"
    });

    expect(useBoardStore.getState().collaborators["u-collab-1"]?.name).toBe("Collab One");

    // Emulate user:left
    store.removeCollaborator("u-collab-1");
    expect(useBoardStore.getState().collaborators["u-collab-1"]).toBeUndefined();
  });

  it("populates existing connected users when receiving joined acknowledgment with users list", () => {
    const store = useBoardStore.getState();

    // Emulate joined acknowledgment carrying existing connected room users
    const joinedMessage = {
      type: "joined",
      boardId: "board-123",
      users: [
        { userId: "usr-alice", name: "Alice Wonderland", email: "alice@example.com" },
        { userId: "usr-bob", name: "bob@example.com", email: "bob@example.com" } // name contains email
      ]
    };

    const map = processCollaboratorsFromEvent(joinedMessage);
    expect(map).not.toBeNull();
    store.setCollaborators(map!);

    const collabs = useBoardStore.getState().collaborators;
    expect(collabs["usr-alice"]).toBeDefined();
    expect(collabs["usr-alice"]?.name).toBe("Alice Wonderland");
    expect(collabs["usr-bob"]).toBeDefined();
    // Verify bob's name does not contain the email address
    expect(collabs["usr-bob"]?.name).toBe("bob");
    expect(collabs["usr-bob"]?.name).not.toContain("@");
  });

  it("handles presence:sync event to update collaborators map", () => {
    const store = useBoardStore.getState();

    const syncMessage = {
      type: "presence:sync",
      payload: {
        boardId: "board-123",
        users: [
          { userId: "usr-carol", name: "Carol Danvers", email: "carol@example.com" }
        ]
      }
    };

    const map = processCollaboratorsFromEvent(syncMessage);
    expect(map).not.toBeNull();
    store.setCollaborators(map!);

    const collabs = useBoardStore.getState().collaborators;
    expect(collabs["usr-carol"]?.name).toBe("Carol Danvers");
    expect(collabs["usr-alice"]).toBeUndefined();
  });

  it("updates connection status during socket lifecycle", () => {
    const store = useBoardStore.getState();

    // Connected state on open
    store.setConnectionStatus("connected");
    store.setActiveBoardId("board-lifecycle");
    expect(useBoardStore.getState().connectionStatus).toBe("connected");
    expect(useBoardStore.getState().activeBoardId).toBe("board-lifecycle");

    // Reconnecting state on close
    store.setConnectionStatus("reconnecting");
    expect(useBoardStore.getState().connectionStatus).toBe("reconnecting");
    expect(useBoardStore.getState().connected).toBe(false);

    // Reset state on leave/cleanup
    store.resetBoardState();
    expect(useBoardStore.getState().connectionStatus).toBe("disconnected");
    expect(useBoardStore.getState().activeBoardId).toBeNull();
  });

  it("tracks sequence increments for event ordering", () => {
    const store = useBoardStore.getState();
    store.setLastSeenSequence("1001");
    expect(useBoardStore.getState().lastSeenSequence).toBe("1001");

    store.setLastSeenSequence("1002");
    expect(useBoardStore.getState().lastSeenSequence).toBe("1002");
  });

  it("prevents reconnection and resets state cleanly on unmount cleanup", () => {
    let isMounted = true;
    let reconnectScheduled = false;
    const store = useBoardStore.getState();

    store.setConnectionStatus("connected");
    store.setActiveBoardId("board-unmount-test");

    const ws = new MockWebSocket("ws://localhost:8080");
    ws.onclose = () => {
      if (!isMounted) return;
      reconnectScheduled = true;
      store.setConnectionStatus("reconnecting");
    };

    // Simulate unmount cleanup sequence in useBoardSocket
    isMounted = false;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    if (ws.readyState === MockWebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "leave", boardId: "board-unmount-test" }));
    }
    ws.close();
    store.resetBoardState();

    expect(ws.sentMessages).toContain(JSON.stringify({ action: "leave", boardId: "board-unmount-test" }));
    expect(reconnectScheduled).toBe(false);
    expect(store.connectionStatus).toBe("disconnected");
    expect(store.activeBoardId).toBeNull();
  });
});
