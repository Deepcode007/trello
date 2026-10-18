import React, { useState } from "react";
import { PlusCircle, Kanban, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { BoardCard } from "./BoardCard";
import { CreateBoardModal } from "./CreateBoardModal";
import { useOrgBoardsQuery } from "../../hooks/useBoardQueries";
import { useRole } from "../../hooks/useRole";
import { getBoardErrorMessage } from "../../lib/board-api";

interface BoardListProps {
  orgId: string;
}

export function BoardList({ orgId }: BoardListProps) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { data: boards, isLoading, isError, error, refetch } = useOrgBoardsQuery(orgId);
  const { canCreateBoard } = useRole(orgId);

  const boardList = boards ?? [];

  return (
    <section className="space-y-4" aria-label="Organization Boards">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Kanban className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Boards
              </h2>
              {!isLoading && (
                <Badge variant="secondary" className="px-2 py-0.5 text-xs font-semibold">
                  {boardList.length}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Workflow boards and kanban task spaces in this organization.
            </p>
          </div>
        </div>

        {canCreateBoard && (
          <Button
            size="sm"
            onClick={() => setCreateModalOpen(true)}
            className="gap-1.5 text-xs font-medium"
            data-testid="create-board-button"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Create Board
          </Button>
        )}
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="board-list-loading">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-5 shadow-sm animate-pulse space-y-4"
            >
              <div className="h-2 w-full bg-secondary/80 rounded" />
              <div className="space-y-2">
                <div className="h-5 w-3/4 bg-secondary/80 rounded" />
                <div className="h-3.5 w-full bg-secondary/60 rounded" />
                <div className="h-3.5 w-1/2 bg-secondary/60 rounded" />
              </div>
              <div className="pt-3 border-t border-border/40 flex justify-between">
                <div className="h-3 w-16 bg-secondary/60 rounded" />
                <div className="h-3 w-20 bg-secondary/60 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3">
            <AlertCircle className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-destructive">
            Failed to load boards
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md">
            {getBoardErrorMessage(error, "An error occurred while fetching organization boards.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-4 gap-1.5 text-xs"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && boardList.length === 0 && (
        <div
          data-testid="board-list-empty"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-10 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
            <Kanban className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            No boards yet
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            {canCreateBoard
              ? "Create your first board to start tracking issues, organizing workflows, and collaborating with your team."
              : "No boards have been created in this organization yet. Ask an admin or employee to create one."}
          </p>
          {canCreateBoard && (
            <Button
              size="sm"
              onClick={() => setCreateModalOpen(true)}
              className="mt-4 gap-1.5 text-xs"
              data-testid="empty-create-board-button"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Create Board
            </Button>
          )}
        </div>
      )}

      {/* Board Cards Grid */}
      {!isLoading && !isError && boardList.length > 0 && (
        <div
          data-testid="board-list-grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {boardList.map(board => (
            <BoardCard key={board.id} board={board} orgId={orgId} />
          ))}
        </div>
      )}

      {/* Create Board Modal */}
      <CreateBoardModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        orgId={orgId}
      />
    </section>
  );
}
