import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import React from "react";
import { QueryClient } from "@tanstack/react-query";
import {
  AppSocketManager,
  getAppSocketManager,
  resetAppSocketManager
} from "../hooks/useAppSocket";
import { useAuthStore } from "../store/useAuthStore";
import { clearToasts, toast } from "../components/ui/toast";
import { NOTIFICATION_QUERY_KEYS } from "../hooks/useNotificationQueries";
import {
  formatNotificationDetails,
  getNotificationNavigationTarget
} from "../lib/notification-format";
import type { NotificationResponse } from "../lib/notification-api";

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
}

const originalWebSocket = globalThis.WebSocket;

describe("Phase 6: Realtime Mention Notification Pipeline Suite", () => {
  let queryClient: QueryClient;
  const currentUserId = "00000000-0000-4000-8000-000000000000";
  const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const boardId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const issueId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const commentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  beforeEach(() => {
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
    MockWebSocket.reset();
    resetAppSocketManager();
    clearToasts();

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    useAuthStore.setState({
      token: "mock-valid-jwt",
      user: {
        id: currentUserId,
        email: "alice@example.com",
        username: "alice",
        name: "Alice Smith"
      }
    });
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
    resetAppSocketManager();
    clearToasts();
  });

  it("1. receives mention:comment on user topic via single app-level WebSocket and updates notification cache + unread count", () => {
    const manager = getAppSocketManager();
    manager.setQueryClient(queryClient);
    manager.connect("mock-valid-jwt");

    const ws = MockWebSocket.lastInstance!;
    expect(ws).toBeDefined();
    ws.simulateOpen();

    // Verify socket subscribed to user topic
    expect(ws.sentMessages).toContain(JSON.stringify({ action: "subscribe_user" }));

    // Initialize notification cache
    queryClient.setQueryData(["notifications", "unread-count"], 0);
    queryClient.setQueryData(["notifications"], {
      pages: [{ notifications: [], nextCursor: null }],
      pageParams: [undefined]
    });

    // Simulate incoming realtime mention notification from backend
    const mentionNotification: NotificationResponse = {
      id: "notif-mention-42",
      type: "mention:comment",
      data: {
        commentId,
        issueId,
        cardTitle: "Implement SSO Authentication",
        boardId,
        orgId,
        authorName: "Bob Jones",
        commentPreview: "Hey @[Alice Smith](user:...)"
      },
      read: false,
      createdAt: new Date().toISOString()
    };

    ws.simulateMessage({
      type: "user:notification",
      payload: {
        notification: mentionNotification
      }
    });

    // Verify notification cache updated
    const unreadCount = queryClient.getQueryData<number>(["notifications", "unread-count"]);
    expect(unreadCount).toBe(1);

    const listData = queryClient.getQueryData<{ pages: Array<{ notifications: NotificationResponse[] }> }>(
      ["notifications"]
    );
    expect(listData?.pages[0]?.notifications?.length).toBe(1);
    expect(listData?.pages[0]?.notifications[0]?.id).toBe("notif-mention-42");

    // Strictly ONE socket connection used throughout
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("2. formats mention:comment notification title, description, and navigation target correctly", () => {
    const notif: NotificationResponse = {
      id: "notif-mention-88",
      type: "mention:comment",
      data: {
        commentId,
        issueId,
        cardTitle: "Refactor API Controllers",
        boardId,
        orgId,
        authorName: "Bob Jones",
        commentPreview: "Please check this"
      },
      read: false,
      createdAt: new Date().toISOString()
    };

    const details = formatNotificationDetails(notif);
    expect(details.title).toBe("Mentioned in Comment");
    expect(details.description).toBe('Bob Jones mentioned you in a comment on "Refactor API Controllers"');
    expect(details.actorName).toBe("Bob Jones");

    const target = getNotificationNavigationTarget(notif);
    expect(target).toBe(`/orgs/${orgId}/boards/${boardId}?card=${issueId}`);
  });

  it("3. handles malformed or missing mention notification data safely without crashing", () => {
    const malformedNotif = {
      type: "mention:comment",
      data: undefined
    };

    const details = formatNotificationDetails(malformedNotif as any);
    expect(details.title).toBe("Mentioned in Comment");
    expect(details.description).toBe("Someone mentioned you in a comment");

    const target = getNotificationNavigationTarget(malformedNotif as any);
    expect(target).toBeNull();
  });
});
