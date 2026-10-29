import type { NotificationResponse } from "./notification-api";

export interface FormattedNotification {
  title: string;
  description: string;
  actorName?: string;
}

/**
 * Formats a notification into human-readable title and description
 * based on notification type and data payload.
 */
export function formatNotificationDetails(notification: {
  type: string;
  data?: Record<string, any>;
}): FormattedNotification {
  const type = notification.type;
  const data = notification.data || {};

  switch (type) {
    case "org:invitation_received": {
      const inviter = data.invitedByName || "An administrator";
      const orgName = data.orgName || "an organization";
      return {
        title: "Organization Invitation",
        description: `${inviter} invited you to join ${orgName}`,
        actorName: inviter
      };
    }

    case "org:invitation_accepted": {
      const user = data.userName || data.userEmail || "A member";
      const orgName = data.orgName || "the organization";
      return {
        title: "Invitation Accepted",
        description: `${user} accepted the invitation to ${orgName}`,
        actorName: user
      };
    }

    case "org:role_changed": {
      const changer = data.changedByName;
      const role = data.role || data.newRole || "member";
      const orgName = data.orgName || "the organization";
      return {
        title: "Role Updated",
        description: changer
          ? `${changer} changed your role in ${orgName} to ${role}`
          : `Your role in ${orgName} was changed to ${role}`,
        actorName: changer
      };
    }

    case "org:member_removed": {
      const remover = data.removedByName;
      const orgName = data.orgName || "the organization";
      return {
        title: "Removed from Organization",
        description: remover
          ? `${remover} removed you from ${orgName}`
          : `You were removed from ${orgName}`,
        actorName: remover
      };
    }

    case "card:assigned": {
      const assigner = data.assignedByName || "Someone";
      const cardTitle = data.cardTitle || data.issueTitle || "a card";
      return {
        title: "Card Assigned",
        description: `${assigner} assigned you to "${cardTitle}"`,
        actorName: assigner
      };
    }

    case "comment:reply": {
      const author = data.authorName || "Someone";
      const cardTitle = data.cardTitle ? ` on "${data.cardTitle}"` : "";
      return {
        title: "Comment Reply",
        description: `${author} replied to your comment${cardTitle}`,
        actorName: author
      };
    }

    case "mention:comment": {
      const author = data.authorName || "Someone";
      const cardTitle = data.cardTitle ? ` on "${data.cardTitle}"` : "";
      return {
        title: "Mentioned in Comment",
        description: `${author} mentioned you in a comment${cardTitle}`,
        actorName: author
      };
    }

    default: {
      return {
        title: "Notification",
        description: typeof data.message === "string" ? data.message : "You have received a new notification"
      };
    }
  }
}

/**
 * Determines the navigation target URL for a notification if valid target data exists.
 * Returns null if no valid target exists.
 */
export function getNotificationNavigationTarget(
  notification: Pick<NotificationResponse, "type" | "data">
): string | null {
  const { type, data } = notification;
  if (!data) return null;

  // If both orgId and boardId are present, navigate to board canvas
  if (typeof data.orgId === "string" && data.orgId.trim() && typeof data.boardId === "string" && data.boardId.trim()) {
    return `/orgs/${data.orgId}/boards/${data.boardId}`;
  }

  // Org-level notifications navigate to dashboard where pending invites / org context is visible
  if (
    type === "org:invitation_received" ||
    type === "org:invitation_accepted" ||
    type === "org:role_changed" ||
    type === "org:member_removed"
  ) {
    return "/";
  }

  return null;
}

/**
 * Formats a relative timestamp (e.g. "Just now", "5m ago", "2h ago", "Oct 24")
 */
export function formatRelativeTime(dateInput: string | Date | number): string {
  const date = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  if (!date || isNaN(date.getTime())) return "";

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHour / 24);

  if (diffSec < 45) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
