import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData
} from "@tanstack/react-query";
import {
  notificationApi,
  type NotificationResponse,
  type NotificationsPageResponse
} from "../lib/notification-api";
import { useAuthStore } from "../store/useAuthStore";

export const NOTIFICATION_QUERY_KEYS = {
  all: ["notifications"] as const,
  list: () => ["notifications"] as const,
  unreadCount: () => ["notifications", "unread-count"] as const
};

export interface UseNotificationsOptions {
  limit?: number;
  enabled?: boolean;
}

/**
 * Paginated infinite query for notifications list.
 * Stale time: 30,000ms.
 * Default page size: 20.
 */
export function useNotifications(options?: UseNotificationsOptions) {
  const token = useAuthStore(s => s.token);
  const isEnabled = options?.enabled !== undefined ? options.enabled : Boolean(token);
  const pageSize = options?.limit ?? 20;

  return useInfiniteQuery<NotificationsPageResponse>({
    queryKey: NOTIFICATION_QUERY_KEYS.list(),
    queryFn: ({ pageParam }) =>
      notificationApi.getNotifications({
        cursor: pageParam as string | undefined,
        limit: pageSize
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: isEnabled
  });
}

/**
 * Query for unread notification count.
 * Stale time: 10,000ms.
 * Refetch interval: 60,000ms.
 */
export function useUnreadCount(options?: { enabled?: boolean }) {
  const token = useAuthStore(s => s.token);
  const isEnabled = options?.enabled !== undefined ? options.enabled : Boolean(token);

  return useQuery<number>({
    queryKey: NOTIFICATION_QUERY_KEYS.unreadCount(),
    queryFn: () => notificationApi.getUnreadCount(),
    staleTime: 10_000,
    refetchInterval: 60_000,
    enabled: isEnabled
  });
}

/**
 * Optimistic mutation to mark a single notification as read.
 * Decrements unread count (if currently unread) and marks item read in list cache.
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => notificationApi.markAsRead(notificationId),
    onMutate: async (notificationId: string) => {
      // 1. Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_QUERY_KEYS.unreadCount() });
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_QUERY_KEYS.list() });

      // 2. Snapshot previous state
      const previousCount = queryClient.getQueryData<number>(NOTIFICATION_QUERY_KEYS.unreadCount());
      const previousList = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list()
      );

      // 3. Determine if notification was previously unread
      let wasUnread = true;
      if (previousList) {
        for (const page of previousList.pages) {
          const found = page.notifications.find(n => n.id === notificationId);
          if (found) {
            wasUnread = !found.read;
            break;
          }
        }
      }

      // 4. Optimistically decrement unread count (never negative)
      if (wasUnread) {
        queryClient.setQueryData<number>(
          NOTIFICATION_QUERY_KEYS.unreadCount(),
          (oldCount = 0) => Math.max(0, oldCount - 1)
        );
      }

      // 5. Optimistically update list cache
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        old => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map(page => ({
              ...page,
              notifications: page.notifications.map(n =>
                n.id === notificationId ? { ...n, read: true } : n
              )
            }))
          };
        }
      );

      return { previousCount, previousList, wasUnread };
    },
    onError: (_err, _id, context) => {
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), context.previousCount);
      }
      if (context?.previousList) {
        queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.list(), context.previousList);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEYS.unreadCount() });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEYS.list() });
    }
  });
}

/**
 * Optimistic mutation to mark all notifications as read.
 * Sets unread count to 0 and marks all loaded notifications as read.
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onMutate: async () => {
      // 1. Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_QUERY_KEYS.unreadCount() });
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_QUERY_KEYS.list() });

      // 2. Snapshot previous state
      const previousCount = queryClient.getQueryData<number>(NOTIFICATION_QUERY_KEYS.unreadCount());
      const previousList = queryClient.getQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list()
      );

      // 3. Optimistically set unread count to zero
      queryClient.setQueryData<number>(NOTIFICATION_QUERY_KEYS.unreadCount(), 0);

      // 4. Optimistically mark all loaded notifications as read
      queryClient.setQueryData<InfiniteData<NotificationsPageResponse>>(
        NOTIFICATION_QUERY_KEYS.list(),
        old => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map(page => ({
              ...page,
              notifications: page.notifications.map(n => ({ ...n, read: true }))
            }))
          };
        }
      );

      return { previousCount, previousList };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.unreadCount(), context.previousCount);
      }
      if (context?.previousList) {
        queryClient.setQueryData(NOTIFICATION_QUERY_KEYS.list(), context.previousList);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEYS.unreadCount() });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEYS.list() });
    }
  });
}
