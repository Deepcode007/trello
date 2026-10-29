import React from "react";
import { Bell, Loader2, AlertCircle } from "lucide-react";
import { useNotifications } from "../../hooks/useNotificationQueries";
import { NotificationItem } from "./NotificationItem";
import { Button } from "../ui/button";

export interface NotificationListProps {
  onCloseDropdown?: () => void;
}

export function NotificationList({ onCloseDropdown }: NotificationListProps) {
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch
  } = useNotifications();

  const notifications = data?.pages.flatMap(page => page.notifications) ?? [];

  if (isLoading) {
    return (
      <div
        data-testid="notifications-loading"
        className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-xs">Loading notifications...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="notifications-error"
        className="flex h-40 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground"
      >
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span className="text-xs">Failed to load notifications</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-7 text-xs mt-1"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div
        data-testid="notifications-empty"
        className="flex h-44 flex-col items-center justify-center gap-2 text-center p-6 text-muted-foreground"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary/80">
          <Bell className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-xs font-medium text-foreground">No notifications</p>
        <p className="text-[11px] text-muted-foreground">
          You are all caught up! Updates and invitations will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        data-testid="notifications-scroll-area"
        className="max-h-[380px] overflow-y-auto divide-y divide-border/40"
      >
        {notifications.map(notification => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onCloseDropdown={onCloseDropdown}
          />
        ))}
      </div>

      {hasNextPage && (
        <div className="border-t border-border/40 p-2 text-center bg-card">
          <Button
            variant="ghost"
            size="sm"
            data-testid="load-more-notifications-btn"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {isFetchingNextPage ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading more...
              </span>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
