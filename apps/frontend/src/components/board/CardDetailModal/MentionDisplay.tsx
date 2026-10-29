import React from "react";

export interface MentionDisplayProps {
  content: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Regex for parsing mention markup: @[DisplayName](user:userId)
 */
const MENTION_REGEX = /@\[([^\]]+)\]\(user:([a-zA-Z0-9_-]+)\)/g;

export function MentionDisplay({
  content,
  className,
  "data-testid": testId
}: MentionDisplayProps) {
  if (!content || typeof content !== "string") {
    return null;
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(MENTION_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // Ordinary text preceding the mention
    if (match.index > lastIndex) {
      nodes.push(content.substring(lastIndex, match.index));
    }

    const displayName = match[1]?.trim() || "User";
    const userId = match[2]?.trim() || "";

    nodes.push(
      <span
        key={`mention-${match.index}-${userId}`}
        data-testid="mention-badge"
        data-user-id={userId}
        className="inline-flex items-center font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors px-1.5 py-0.5 rounded text-xs select-none cursor-default"
      >
        @{displayName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Trailing text after the last mention
  if (lastIndex < content.length) {
    nodes.push(content.substring(lastIndex));
  }

  return (
    <div
      data-testid={testId}
      className={className || "text-foreground leading-relaxed whitespace-pre-wrap"}
    >
      {nodes}
    </div>
  );
}
