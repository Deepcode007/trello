import { api } from "./api";
import type { NotificationType } from "realtime";

export interface NotificationResponse {
  id: string;
  recipientId?: string;
  type: NotificationType | string;
  data: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export interface NotificationsPageResponse {
  notifications: NotificationResponse[];
  nextCursor: string | null;
}

export interface MarkAsReadResponse {
  success: boolean;
}

export interface MarkAllAsReadResponse {
  success: boolean;
  count: number;
}

export const notificationApi = {
  getNotifications: async (params?: {
    cursor?: string | null;
    limit?: number;
  }): Promise<NotificationsPageResponse> => {
    const res = await api.get("/api/notifications", {
      params: {
        ...(params?.cursor ? { cursor: params.cursor } : {}),
        ...(params?.limit ? { limit: params.limit } : {})
      }
    });

    const data = res.data?.data ?? res.data;
    return {
      notifications: data?.notifications ?? [],
      nextCursor: data?.nextCursor ?? null
    };
  },

  getUnreadCount: async (): Promise<number> => {
    const res = await api.get("/api/notifications/unread-count");
    const data = res.data?.data ?? res.data;
    if (typeof data === "number") return data;
    if (typeof data?.count === "number") return data.count;
    if (typeof res.data?.count === "number") return res.data.count;
    return 0;
  },

  markAsRead: async (notificationId: string): Promise<MarkAsReadResponse> => {
    const res = await api.patch(`/api/notifications/${notificationId}/read`);
    const data = res.data?.data ?? res.data;
    return {
      success: data?.success ?? true
    };
  },

  markAllAsRead: async (): Promise<MarkAllAsReadResponse> => {
    const res = await api.patch("/api/notifications/read-all");
    const data = res.data?.data ?? res.data;
    return {
      success: data?.success ?? true,
      count: typeof data?.count === "number" ? data.count : (res.data?.count ?? 0)
    };
  }
};
