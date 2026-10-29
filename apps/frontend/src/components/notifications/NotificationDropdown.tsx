import React from "react";
import { CheckCheck } from "lucide-react";
import { useMarkAllAsRead, useUnreadCount } from "../../hooks/useNotificationQueries";
import { NotificationList } from "./NotificationList";
import { Button } from "../ui/button";

export interface NotificationDropdownProps {
  onClose?: () => void;
}

export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const { data: unreadCount = 0 } = useUnreadCount();
  const { mutate: markAllAsRead, isPending } = useMarkAllAsRead();

  const handleMarkAllRead = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (unreadCount > 0 && !isPending) {
      markAllAsRead();
    }
  };

  return (
    <div
      data-testid="notification-dropdown"
      className="w-80 sm:w-96 rounded-xl border border-border bg-card text-card-foreground shadow-xl overflow-hidden focus:outline-none"
    >
      {/* Dropdown Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-secondary/20">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <span
              data-testid="header-unread-count"
              className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary"
            >
              {unreadCount} new
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          data-testid="mark-all-read-btn"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0 || isPending}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 gap-1 font-medium"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          <span>Mark all read</span>
        </Button>
      </div>

      {/* Dropdown Notification List */}
      <NotificationList onCloseDropdown={onClose} />
    </div>
  );
}
