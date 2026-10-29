import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail,
  Shield,
  UserX,
  UserCheck,
  CheckCircle,
  MessageSquare,
  Bookmark,
  Bell
} from "lucide-react";
import type { NotificationResponse } from "../../lib/notification-api";
import {
  formatNotificationDetails,
  formatRelativeTime,
  getNotificationNavigationTarget
} from "../../lib/notification-format";
import { useMarkAsRead } from "../../hooks/useNotificationQueries";

export interface NotificationItemProps {
  notification: NotificationResponse;
  onCloseDropdown?: () => void;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "org:invitation_received":
      return <Mail className="h-4 w-4 text-amber-500" />;
    case "org:invitation_accepted":
      return <UserCheck className="h-4 w-4 text-emerald-500" />;
    case "org:role_changed":
      return <Shield className="h-4 w-4 text-indigo-500" />;
    case "org:member_removed":
      return <UserX className="h-4 w-4 text-rose-500" />;
    case "card:assigned":
      return <Bookmark className="h-4 w-4 text-blue-500" />;
    case "mention:comment":
    case "comment:reply":
      return <MessageSquare className="h-4 w-4 text-purple-500" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

export function NotificationItem({ notification, onCloseDropdown }: NotificationItemProps) {
  const navigate = useNavigate();
  const { mutate: markAsRead } = useMarkAsRead();

  const { title, description } = formatNotificationDetails(notification);
  const relativeTime = formatRelativeTime(notification.createdAt);
  const navigationTarget = getNotificationNavigationTarget(notification);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!notification.read) {
      markAsRead(notification.id);
    }
    if (navigationTarget) {
      navigate(navigationTarget);
    }
    onCloseDropdown?.();
  };

  const handleMarkReadOnly = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!notification.read) {
      markAsRead(notification.id);
    }
  };

  return (
    <div
      data-testid="notification-item"
      data-notification-id={notification.id}
      data-read={notification.read ? "true" : "false"}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      className={`group relative flex items-start gap-3 p-3.5 text-left transition-colors cursor-pointer border-b border-border/40 last:border-b-0 ${
        notification.read
          ? "bg-card hover:bg-accent/40 text-muted-foreground"
          : "bg-primary/5 hover:bg-primary/10 text-foreground"
      }`}
    >
      {/* Unread blue dot indicator */}
      {!notification.read && (
        <span
          data-testid="unread-indicator"
          aria-label="Unread notification"
          className="absolute left-1.5 top-5 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500"
        />
      )}

      {/* Icon / Actor indicator */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/80 border border-border/60">
        {getNotificationIcon(notification.type)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground truncate">{title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-2">
          {description}
        </p>
      </div>

      {/* Mark single as read button */}
      {!notification.read && (
        <button
          type="button"
          data-testid="mark-one-read-btn"
          aria-label="Mark notification as read"
          onClick={handleMarkReadOnly}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <CheckCircle className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
