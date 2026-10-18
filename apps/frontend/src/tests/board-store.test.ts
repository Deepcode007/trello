import { describe, it, expect, beforeEach } from "bun:test";
import { useBoardStore } from "../store/useBoardStore";

describe("useBoardStore state management", () => {
  beforeEach(() => {
    useBoardStore.getState().resetBoardState();
  });

  it("initializes with default disconnected and empty state", () => {
    const state = useBoardStore.getState();
    expect(state.connected).toBe(false);
    expect(state.connectionStatus).toBe("disconnected");
    expect(state.activeBoardId).toBeNull();
    expect(state.collaborators).toEqual({});
    expect(state.lastSeenSequence).toBeNull();
  });

  it("updates connection status and synchronizes connected boolean flag", () => {
    const store = useBoardStore.getState();

    store.setConnectionStatus("connected");
    expect(useBoardStore.getState().connectionStatus).toBe("connected");
    expect(useBoardStore.getState().connected).toBe(true);

    store.setConnectionStatus("reconnecting");
    expect(useBoardStore.getState().connectionStatus).toBe("reconnecting");
    expect(useBoardStore.getState().connected).toBe(false);

    store.setConnectionStatus("disconnected");
    expect(useBoardStore.getState().connectionStatus).toBe("disconnected");
    expect(useBoardStore.getState().connected).toBe(false);
  });

  it("updates connected flag and synchronizes connection status string", () => {
    const store = useBoardStore.getState();

    store.setConnected(true);
    expect(useBoardStore.getState().connected).toBe(true);
    expect(useBoardStore.getState().connectionStatus).toBe("connected");

    store.setConnected(false);
    expect(useBoardStore.getState().connected).toBe(false);
    expect(useBoardStore.getState().connectionStatus).toBe("disconnected");
  });

  it("sets activeBoardId", () => {
    useBoardStore.getState().setActiveBoardId("board-123");
    expect(useBoardStore.getState().activeBoardId).toBe("board-123");

    useBoardStore.getState().setActiveBoardId(null);
    expect(useBoardStore.getState().activeBoardId).toBeNull();
  });

  it("adds, updates, and removes collaborators by userId", () => {
    const store = useBoardStore.getState();

    store.addCollaborator({
      userId: "u-1",
      name: "Alice Smith",
      email: "alice@example.com"
    });

    store.addCollaborator({
      userId: "u-2",
      name: "Bob Jones",
      email: "bob@example.com"
    });

    let current = useBoardStore.getState().collaborators;
    expect(Object.keys(current).length).toBe(2);
    expect(current["u-1"]?.name).toBe("Alice Smith");
    expect(current["u-2"]?.email).toBe("bob@example.com");

    // Remove collaborator
    useBoardStore.getState().removeCollaborator("u-1");
    current = useBoardStore.getState().collaborators;
    expect(current["u-1"]).toBeUndefined();
    expect(current["u-2"]?.name).toBe("Bob Jones");
  });

  it("bulk sets collaborators map", () => {
    useBoardStore.getState().setCollaborators({
      "u-10": { userId: "u-10", name: "User 10" },
      "u-20": { userId: "u-20", name: "User 20" }
    });

    const collaborators = useBoardStore.getState().collaborators;
    expect(Object.keys(collaborators).length).toBe(2);
    expect(collaborators["u-10"]?.name).toBe("User 10");
  });

  it("sets lastSeenSequence string", () => {
    useBoardStore.getState().setLastSeenSequence("42");
    expect(useBoardStore.getState().lastSeenSequence).toBe("42");
  });

  it("resets entire board state on resetBoardState", () => {
    const store = useBoardStore.getState();
    store.setConnectionStatus("connected");
    store.setActiveBoardId("board-xyz");
    store.addCollaborator({ userId: "u-99", name: "Eve" });
    store.setLastSeenSequence("105");

    store.resetBoardState();

    const state = useBoardStore.getState();
    expect(state.connected).toBe(false);
    expect(state.connectionStatus).toBe("disconnected");
    expect(state.activeBoardId).toBeNull();
    expect(state.collaborators).toEqual({});
    expect(state.lastSeenSequence).toBeNull();
  });
});
