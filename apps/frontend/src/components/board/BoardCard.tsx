import React from "react";
import { useNavigate } from "react-router-dom";
import { Kanban, Archive } from "lucide-react";
import { Badge } from "../ui/badge";
import type { BoardSummary } from "../../lib/board-api";

interface BoardCardProps {
  board: BoardSummary;
  orgId: string;
}

export function BoardCard({ board, orgId }: BoardCardProps) {
  const navigate = useNavigate();
  const accentColor = board.color || "#3b82f6";
  const issueCount = board._count?.issues ?? 0;

  const handleClick = () => {
    navigate(`/orgs/${orgId}/boards/${board.id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(`/orgs/${orgId}/boards/${board.id}`);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`board-card-${board.id}`}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      {/* Color accent bar */}
      <div
        className="h-2 w-full transition-opacity group-hover:opacity-90"
        style={{ backgroundColor: accentColor }}
        data-testid="board-card-accent"
      />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors text-base">
            {board.title}
          </h3>
          {board.isArchived && (
            <Badge variant="secondary" className="gap-1 text-xs shrink-0 bg-muted/80 text-muted-foreground">
              <Archive className="h-3 w-3" />
              Archived
            </Badge>
          )}
        </div>

        {board.description ? (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {board.description}
          </p>
        ) : (
          <p className="mt-2 text-xs italic text-muted-foreground/60">
            No description provided
          </p>
        )}

        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <Kanban className="h-3.5 w-3.5 text-muted-foreground/80" />
            <span>{issueCount} {issueCount === 1 ? "card" : "cards"}</span>
          </span>
          <span className="text-xs font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            Open Board &rarr;
          </span>
        </div>
      </div>
    </div>
  );
}
