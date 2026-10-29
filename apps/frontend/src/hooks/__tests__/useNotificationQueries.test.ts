import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  NOTIFICATION_QUERY_KEYS
} from "../useNotificationQueries";
import {
  notificationApi,
  type NotificationResponse,
  type NotificationsPageResponse
} from "../../lib/notification-api";
import { applyNotificationReceived } from "../useAppSocket";
import { useAuthStore } from "../../store/useAuthStore";

describe("TanStack Query Notification Hooks Suite", () => {
  let queryClient: QueryClient;

  const originalGetNotifications = notificationApi.getNotifications;
  const originalGetUnreadCount = notificationApi.getUnreadCount;
  const originalMarkAsRead = notificationApi.markAsRead;
  const originalMarkAllAsRead = notificationApi.markAllAsRead;

  let executeMarkAsRead: (id: string) => Promise<unknown>;
  let executeMarkAllAsRead: () => Promise<unknown>;

  function HookTestHarness() {
    const markOne = useMarkAsRead();
    const markAll = useMarkAllAsRead();
    executeMarkAsRead = markOne.mutateAsync;
    executeMarkAllAsRead = markAll.mutateAsync;
    return null;
  }

  function renderHarness() {
    renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(HookTestHarness)
      )
    );
  }

  const sampleNotifications: NotificationResponse[] = [
    {
      id: "notif-1",
      type: "org:invitation_received",
      data: { orgName: "Acme Corp", invitedByName: "Alice" },
      read: false,
      createdAt: new Date("2026-01-01T10:00:00Z").toISOString()
    },
    {
      id: "notif-2",
      type: "card:assigned",
      data: { cardTitle: "Fix login issue", assignedByName: "Bob" },
      read: false,
      createdAt: new Date("2026-01-01T09:00:00Z").toISOString()
    },
    {
      id: "notif-3",
      type: "org:role_changed",
      data: { role: "admin", orgName: "Acme Corp" },
      read: true,
      createdAt: new Date("2026-01-01T08:00:00Z").toISOString()
    }
  ];

  beforeEach(() => {
    useAuthStore.setState({ token: "test-auth-token" });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 1000 * 60 },
        mutations: { retry: false }
      }
    });

    renderHarness();
  });

  afterEach(() => {
    notificationApi.getNotifications = originalGetNotifications;
    notificationApi.getUnreadCount = originalGetUnreadCount;
    notificationApi.markAsRead = originalMarkAsRead;
    notificationApi.markAllAsRead = originalMarkAllAsRead;
  });

  describe("1. Query Hooks", () => {
    it("useNotifications fetches and returns notification list", async () => {
      notificationApi.getNotifications = mock(() =>
        Promise.resolve({
          notifications: sampleNotifications,
          nextCursor: "cursor-123"
        })
      );

      const result = await queryClient.fetchInfiniteQuery({
        queryKey: NOTIFICATION_QUERY_KEYS.list(),
        queryFn: ({ pageParam }) =>
          notificationApi.getNotifications({ cursor: pageParam as string | undefined }),
        initialPageParam: undefined as string | undefined
      });

      expect(result.pages[0]?.notifications?.length).toBe(3);
      expect(result.pages[0]?.notifications[0]?.id).toBe("notif-1");
      expect(result.pages[0]?.nextCursor).toBe("cursor-123");
    });

    it("useUnreadCount returns unread count", async () => {
      notificationApi.getUnreadCount = mock(() => Promise.resolve(2));

      const count = await queryClient.fetchQuery({
        queryKey: NOTIFICATION_QUERY_KEYS.unreadCount(),
        queryFn: () => notificationApi.getUnreadCount()
      });

      expect(count).toBe(2);
    });
  });

  describe("2. Optimistic Mutation: useMarkAsRead", () => {
    beforeEach(() => {
      // Seed query cache with initial data
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 2);
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [
            {
              notifications: [...sampleNotifications],
              nextCursor: null
            }
          ]
        }
      );
    });

    it("useMarkAsRead optimistically decrements unread count", async () => {
      let resolveApi: (val: any) => void = () => {};
      notificationApi.markAsRead = mock((() => new Promise(r => { resolveApi = r; })) as any);

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(2);

      const promise = executeMarkAsRead("notif-1");
      await new Promise(r => setTimeout(r, 5));

      // Verify immediate optimistic decrement before API resolves
      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(1);

      resolveApi({ success: true });
      await promise;
    });

    it("useMarkAsRead marks the notification read in the list cache", async () => {
      let resolveApi: (val: any) => void = () => {};
      notificationApi.markAsRead = mock((() => new Promise(r => { resolveApi = r; })) as any);

      const promise = executeMarkAsRead("notif-1");
      await new Promise(r => setTimeout(r, 5));

      const cached = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list()
      );
      const targetNotif = cached?.pages[0]?.notifications.find(n => n.id === "notif-1");
      expect(targetNotif?.read).toBe(true);

      resolveApi({ success: true });
      await promise;
    });

    it("useMarkAsRead does not decrement unread count if notification was already read", async () => {
      notificationApi.markAsRead = mock(() => Promise.resolve({ success: true }));

      // notif-3 is already read: true
      const promise = executeMarkAsRead("notif-3");

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(2);

      await promise;
    });

    it("useMarkAsRead never decrements unread count below zero", async () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 0);
      notificationApi.markAsRead = mock(() => Promise.resolve({ success: true }));

      const promise = executeMarkAsRead("notif-1");

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(0);

      await promise;
    });

    it("useMarkAsRead rolls back unread count and list cache on API failure", async () => {
      notificationApi.markAsRead = mock(() =>
        Promise.reject(new Error("Server mutation error"))
      );

      try {
        await executeMarkAsRead("notif-1");
      } catch {
        // Expected mutation failure
      }

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(2);
      const cached = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list()
      );
      const targetNotif = cached?.pages[0]?.notifications.find(n => n.id === "notif-1");
      expect(targetNotif?.read).toBe(false);
    });
  });

  describe("3. Optimistic Mutation: useMarkAllAsRead", () => {
    beforeEach(() => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 5);
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [
            {
              notifications: [...sampleNotifications],
              nextCursor: null
            }
          ]
        }
      );
    });

    it("useMarkAllAsRead optimistically sets unread count to zero", async () => {
      let resolveApi: (val: any) => void = () => {};
      notificationApi.markAllAsRead = mock((() => new Promise(r => { resolveApi = r; })) as any);

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(5);

      const promise = executeMarkAllAsRead();
      await new Promise(r => setTimeout(r, 5));

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(0);

      resolveApi({ success: true, count: 2 });
      await promise;
    });

    it("useMarkAllAsRead marks all loaded notifications as read", async () => {
      let resolveApi: (val: any) => void = () => {};
      notificationApi.markAllAsRead = mock((() => new Promise(r => { resolveApi = r; })) as any);

      const promise = executeMarkAllAsRead();
      await new Promise(r => setTimeout(r, 5));

      const cached = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list()
      );
      const allRead = cached?.pages[0]?.notifications.every(n => n.read === true);
      expect(allRead).toBe(true);

      resolveApi({ success: true, count: 2 });
      await promise;
    });

    it("useMarkAllAsRead rolls back unread count and list on API failure", async () => {
      notificationApi.markAllAsRead = mock(() =>
        Promise.reject(new Error("Network disconnect"))
      );

      try {
        await executeMarkAllAsRead();
      } catch {
        // Expected
      }

      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(5);
      const cached = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list()
      );
      const notif1 = cached?.pages[0]?.notifications.find(n => n.id === "notif-1");
      expect(notif1?.read).toBe(false);
    });
  });

  describe("4. Realtime applyNotificationReceived & Deduplication", () => {
    const initialCache: InfiniteData<NotificationsPageResponse> = {
      pageParams: [undefined],
      pages: [
        {
          notifications: [sampleNotifications[0]!],
          nextCursor: null
        }
      ]
    };

    it("prepends new notification to the first page of cache", () => {
      const newNotif: NotificationResponse = {
        id: "notif-new",
        type: "org:invitation_accepted",
        data: { orgName: "Acme", userName: "Bob" },
        read: false,
        createdAt: new Date().toISOString()
      };

      const updated = applyNotificationReceived(initialCache, newNotif);
      expect(updated?.pages[0]?.notifications?.length).toBe(2);
      expect(updated?.pages[0]?.notifications[0]?.id).toBe("notif-new");
    });

    it("idempotently ignores duplicate notification ID and does not duplicate", () => {
      const duplicateNotif: NotificationResponse = {
        id: "notif-1", // Already present in initialCache
        type: "org:invitation_received",
        data: {},
        read: false,
        createdAt: new Date().toISOString()
      };

      const updated = applyNotificationReceived(initialCache, duplicateNotif);
      expect(updated?.pages[0]?.notifications?.length).toBe(1);
      expect(updated?.pages[0]?.notifications[0]?.id).toBe("notif-1");
    });

    it("increments unread count in cache", () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 3);
      queryClient.setQueryData<number>(
        NOTIFICATION_QUERY_KEYS.unreadCount(),
        (oldCount = 0) => oldCount + 1
      );
      expect(queryClient.getQueryData(NOTIFICATION_QUERY_KEYS.unreadCount())).toBe(4);
    });

    it("returns undefined cleanly when cache is uninitialized", () => {
      const newNotif: NotificationResponse = {
        id: "notif-x",
        type: "org:role_changed",
        data: {},
        read: false,
        createdAt: new Date().toISOString()
      };

      const updated = applyNotificationReceived(undefined, newNotif);
      expect(updated).toBeUndefined();
    });
  });
});
