import React from "react";
import { Badge } from "../ui/badge";
import { Avatar } from "../ui/avatar";
import type { BoardIssue } from "../../lib/board-api";
import { Clock, CheckSquare } from "lucide-react";

export interface KanbanCardProps {
  issue: BoardIssue;
  onClick?: () => void;
}

export function formatCardDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return isoString;
  }
}

export function KanbanCard({ issue, onClick }: KanbanCardProps) {
  // Compute checklist progress
  let totalChecklistItems = 0;
  let completedChecklistItems = 0;
  if (issue.checklists && issue.checklists.length > 0) {
    for (const chk of issue.checklists) {
      if (chk.items) {
        for (const item of chk.items) {
          totalChecklistItems++;
          if (item.isCompleted) {
            completedChecklistItems++;
          }
        }
      }
    }
  }

  // Compute past due
  const hasDueDate = Boolean(issue.dueDate);
  const isPastDue = hasDueDate && new Date(issue.dueDate!).getTime() < Date.now();

  return (
    <article
      data-testid={`card-${issue.id}`}
      onClick={onClick}
      className="group relative flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs transition-all hover:border-primary/50 hover:shadow-sm cursor-pointer select-none"
    >
      {/* Top Metadata Row: Labels & Priority */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {issue.labels && issue.labels.length > 0 && (
            issue.labels.map(({ label }) => (
              <span
                key={label.id}
                data-testid={`card-label-${label.id}`}
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-2xs"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </span>
            ))
          )}
        </div>

        {issue.priority && (
          <Badge
            variant={issue.priority}
            data-testid="card-priority-badge"
            className="capitalize text-[10px] px-1.5 py-0 tracking-wide font-medium"
          >
            {issue.priority}
          </Badge>
        )}
      </div>

      {/* Card Title */}
      <h4 className="text-xs font-medium text-foreground line-clamp-2 leading-relaxed">
        {issue.title}
      </h4>

      {/* Bottom Metadata Row: Due Date, Checklist Ratio, Assignee Avatars */}
      {(hasDueDate || totalChecklistItems > 0 || (issue.issueMappings && issue.issueMappings.length > 0)) && (
        <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-border/40 text-muted-foreground">
          <div className="flex items-center gap-2.5">
            {hasDueDate && (
              <div
                className={`flex items-center gap-1 text-[11px] font-medium ${
                  isPastDue ? "text-destructive" : "text-muted-foreground"
                }`}
                {...(isPastDue ? { "data-testid": "due-date-past-due" } : {})}
              >
                <Clock className="h-3 w-3 shrink-0" />
                <span>{formatCardDate(issue.dueDate!)}</span>
              </div>
            )}

            {totalChecklistItems > 0 && (
              <div
                data-testid="card-checklist-ratio"
                className={`flex items-center gap-1 text-[11px] font-medium ${
                  completedChecklistItems === totalChecklistItems
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                }`}
              >
                <CheckSquare className="h-3 w-3 shrink-0" />
                <span>
                  {completedChecklistItems}/{totalChecklistItems}
                </span>
              </div>
            )}
          </div>

          {issue.issueMappings && issue.issueMappings.length > 0 && (
            <div className="flex -space-x-1.5 ml-auto shrink-0">
              {issue.issueMappings.slice(0, 3).map(({ user }) => (
                <Avatar
                  key={user.id}
                  size="sm"
                  name={user.name || user.username}
                  email={user.email}
                  src={user.avatarUrl}
                  className="ring-2 ring-card"
                />
              ))}
              {issue.issueMappings.length > 3 && (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground ring-2 ring-card">
                  +{issue.issueMappings.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
