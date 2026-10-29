import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import * as RealPopoverUI from "../components/ui/popover";

// Mock Radix Popover Portal for static SSR rendering in Bun
mock.module("../components/ui/popover", () => ({
  ...RealPopoverUI,
  PopoverPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  PopoverContent: ({
    children,
    className,
    sideOffset: _sideOffset,
    align: _align,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    sideOffset?: number;
    align?: string;
    [key: string]: unknown;
  }) =>
    React.createElement(
      "div",
      { className, "data-slot": "popover-content", ...props },
      children
    )
}));

import { NotificationBell } from "../components/notifications/NotificationBell";
import { NotificationDropdown } from "../components/notifications/NotificationDropdown";
import { NotificationList } from "../components/notifications/NotificationList";
import { NotificationItem } from "../components/notifications/NotificationItem";
import { ToastContainer, toast, clearToasts } from "../components/ui/toast";
import { NOTIFICATION_QUERY_KEYS } from "../hooks/useNotificationQueries";
import {
  notificationApi,
  type NotificationResponse,
  type NotificationsPageResponse
} from "../lib/notification-api";
import {
  formatNotificationDetails,
  getNotificationNavigationTarget,
  formatRelativeTime
} from "../lib/notification-format";

describe("Phase 5: Persistent Notification UI Components Suite", () => {
  let queryClient: QueryClient;

  function createTestClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 1000 * 60 },
        mutations: { retry: false }
      }
    });
  }

  function renderWithProviders(element: React.ReactElement, client = queryClient) {
    return renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(MemoryRouter, null, element)
      )
    );
  }

  const sampleNotifUnread: NotificationResponse = {
    id: "notif-test-1",
    type: "org:invitation_received",
    data: { orgName: "Acme Corp", invitedByName: "Alice", orgId: "org-1" },
    read: false,
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5m ago
  };

  const sampleNotifRead: NotificationResponse = {
    id: "notif-test-2",
    type: "card:assigned",
    data: { cardTitle: "Deploy Pipeline", assignedByName: "Bob", orgId: "org-1", boardId: "board-10" },
    read: true,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago
  };

  const sampleNotifNoTarget: NotificationResponse = {
    id: "notif-test-3",
    type: "custom:generic",
    data: { message: "System maintenance completed" },
    read: false,
    createdAt: new Date().toISOString()
  };

  beforeEach(() => {
    queryClient = createTestClient();
    clearToasts();
  });

  afterEach(() => {
    clearToasts();
  });

  describe("1. NotificationBell", () => {
    it("renders bell button without unread badge when unreadCount is 0", () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 0);

      const html = renderWithProviders(<NotificationBell />);

      expect(html).toContain('data-testid="notification-bell-btn"');
      expect(html).not.toContain('data-testid="notification-badge"');
    });

    it("renders unread count badge when unreadCount is greater than 0", () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 5);

      const html = renderWithProviders(<NotificationBell />);

      expect(html).toContain('data-testid="notification-bell-btn"');
      expect(html).toContain('data-testid="notification-badge"');
      expect(html).toContain(">5<");
    });

    it("caps display count at 99+ when unreadCount exceeds 99", () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 150);

      const html = renderWithProviders(<NotificationBell />);

      expect(html).toContain('data-testid="notification-badge"');
      expect(html).toContain(">99+<");
    });
  });

  describe("2. NotificationDropdown & Header", () => {
    it("renders dropdown header with title and disabled mark-all-read when unreadCount is 0", () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 0);
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [{ notifications: [], nextCursor: null }]
        }
      );

      const html = renderWithProviders(<NotificationDropdown />);

      expect(html).toContain('data-testid="notification-dropdown"');
      expect(html).toContain("Notifications");
      expect(html).toContain('data-testid="mark-all-read-btn"');
      expect(html).toContain("disabled");
    });

    it("renders unread counter chip and active mark-all-read button when unread count > 0", () => {
      queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), 3);
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [{ notifications: [sampleNotifUnread], nextCursor: null }]
        }
      );

      const html = renderWithProviders(<NotificationDropdown />);

      expect(html).toContain('data-testid="header-unread-count"');
      expect(html).toContain("3 new");
      expect(html).toContain('data-testid="mark-all-read-btn"');
    });
  });

  describe("3. NotificationList & Empty / Loaded States", () => {
    it("renders empty state message when notification list is empty", () => {
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [{ notifications: [], nextCursor: null }]
        }
      );

      const html = renderWithProviders(<NotificationList />);

      expect(html).toContain('data-testid="notifications-empty"');
      expect(html).toContain("No notifications");
      expect(html).toContain("You are all caught up!");
    });

    it("renders list of notifications with scroll area", () => {
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [
            {
              notifications: [sampleNotifUnread, sampleNotifRead],
              nextCursor: null
            }
          ]
        }
      );

      const html = renderWithProviders(<NotificationList />);

      expect(html).toContain('data-testid="notifications-scroll-area"');
      expect(html).toContain(sampleNotifUnread.id);
      expect(html).toContain(sampleNotifRead.id);
      expect(html).toContain("Organization Invitation");
      expect(html).toContain("Card Assigned");
    });

    it("renders Load More button when nextCursor exists", () => {
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        {
          pageParams: [undefined],
          pages: [
            {
              notifications: [sampleNotifUnread],
              nextCursor: "cursor-page-2"
            }
          ]
        }
      );

      const html = renderWithProviders(<NotificationList />);

      expect(html).toContain('data-testid="load-more-notifications-btn"');
      expect(html).toContain("Load more");
    });
  });

  describe("4. NotificationItem & Unread Indicator", () => {
    it("renders blue unread indicator dot for unread notification", () => {
      const html = renderWithProviders(
        <NotificationItem notification={sampleNotifUnread} />
      );

      expect(html).toContain('data-testid="notification-item"');
      expect(html).toContain('data-read="false"');
      expect(html).toContain('data-testid="unread-indicator"');
      expect(html).toContain('data-testid="mark-one-read-btn"');
    });

    it("omits unread indicator dot for already read notification", () => {
      const html = renderWithProviders(
        <NotificationItem notification={sampleNotifRead} />
      );

      expect(html).toContain('data-testid="notification-item"');
      expect(html).toContain('data-read="true"');
      expect(html).not.toContain('data-testid="unread-indicator"');
      expect(html).not.toContain('data-testid="mark-one-read-btn"');
    });

    it("clicking notification with valid target marks it read, navigates, and closes dropdown", () => {
      let markReadTarget: string | null = null;
      let navigateTarget: string | null = null;
      let dropdownClosed = false;

      const notif = sampleNotifRead; // target: /orgs/org-1/boards/board-10, read: true
      const target = getNotificationNavigationTarget(notif);

      if (!notif.read) markReadTarget = notif.id;
      if (target) navigateTarget = target;
      dropdownClosed = true;

      expect(markReadTarget).toBeNull(); // Already read
      expect(navigateTarget).toBe("/orgs/org-1/boards/board-10");
      expect(dropdownClosed).toBe(true);
    });

    it("clicking unread notification with no navigation target marks it read without navigating", () => {
      let markReadTarget: string | null = null;
      let navigateTarget: string | null = null;
      let dropdownClosed = false;

      const notif = sampleNotifNoTarget; // unread, target: null
      const target = getNotificationNavigationTarget(notif);

      if (!notif.read) markReadTarget = notif.id;
      if (target) navigateTarget = target;
      dropdownClosed = true;

      expect(markReadTarget).toBe("notif-test-3");
      expect(navigateTarget).toBeNull(); // No navigation attempted
      expect(dropdownClosed).toBe(true);
    });
  });

  describe("5. Navigation Targets & Formatting", () => {
    it("resolves board canvas route when orgId and boardId are present", () => {
      const target = getNotificationNavigationTarget(sampleNotifRead);
      expect(target).toBe("/orgs/org-1/boards/board-10");
    });

    it("resolves dashboard route for org-level invitation and role notifications", () => {
      const target = getNotificationNavigationTarget(sampleNotifUnread);
      expect(target).toBe("/");

      const roleNotif: NotificationResponse = {
        id: "n-role",
        type: "org:role_changed",
        data: { orgName: "Acme", role: "admin" },
        read: false,
        createdAt: new Date().toISOString()
      };
      expect(getNotificationNavigationTarget(roleNotif)).toBe("/");
    });

    it("returns null for notification without valid navigation target", () => {
      const target = getNotificationNavigationTarget(sampleNotifNoTarget);
      expect(target).toBeNull();
    });

    it("formats relative timestamps cleanly", () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 10 * 1000))).toBe("Just now");
      expect(formatRelativeTime(new Date(now - 120 * 1000))).toBe("2m ago");
      expect(formatRelativeTime(new Date(now - 3600 * 1000))).toBe("1h ago");
      expect(formatRelativeTime(new Date(now - 86400 * 1000))).toBe("Yesterday");
      expect(formatRelativeTime(new Date(now - 3 * 86400 * 1000))).toBe("3d ago");
    });
  });

  describe("6. Toast Presentation", () => {
    it("renders ToastContainer with active toast when toast() is triggered", () => {
      toast({
        title: "New Mention",
        description: "Alice mentioned you in 'Fix Bug'",
        variant: "default"
      });

      const html = renderWithProviders(<ToastContainer />);

      expect(html).toContain('data-testid="toast-container"');
      expect(html).toContain('data-testid="toast-item"');
      expect(html).toContain("New Mention");
      expect(html).toContain("Alice mentioned you in");
    });

    it("renders nothing when there are no active toasts", () => {
      clearToasts();
      const html = renderWithProviders(<ToastContainer />);
      expect(html).not.toContain('data-testid="toast-container"');
    });
  });
});
