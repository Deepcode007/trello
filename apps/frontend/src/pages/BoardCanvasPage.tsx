import React, { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ShieldAlert,
  ArrowLeft,
  Kanban,
  FileQuestion,
  RefreshCw
} from "lucide-react";
import { useOrgStore } from "../store/useOrgStore";
import { useBoardSocket } from "../hooks/useBoardSocket";
import { useBoardDetailsQuery } from "../hooks/useBoardQueries";
import { BoardHeader } from "../components/board/BoardHeader";
import { Button } from "../components/ui/button";
import { getBoardErrorMessage } from "../lib/board-api";

export function BoardCanvasPage() {
  const { orgId, boardId } = useParams<{ orgId: string; boardId: string }>();
  const navigate = useNavigate();
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const setActiveOrgId = useOrgStore(s => s.setActiveOrgId);

  // Sync active organization in store if navigating directly to a board route
  useEffect(() => {
    if (orgId && activeOrgId !== orgId) {
      setActiveOrgId(orgId);
    }
  }, [orgId, activeOrgId, setActiveOrgId]);

  // Subscribe to real-time presence and board socket
  useBoardSocket(boardId);

  // Fetch full board details via TanStack Query
  const {
    data: board,
    isLoading,
    isError,
    error,
    refetch
  } = useBoardDetailsQuery(boardId);

  // Loading skeleton state
  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 h-[calc(100vh-4rem)] overflow-hidden" data-testid="canvas-loading-skeleton">
        {/* Header Skeleton */}
        <div className="border-b bg-card/60 px-6 py-4 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-3 w-40 bg-secondary/80 rounded" />
              <div className="h-6 w-56 bg-secondary/80 rounded" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-8 w-24 bg-secondary/80 rounded-full" />
              <div className="h-8 w-20 bg-secondary/80 rounded-full" />
            </div>
          </div>
        </div>

        {/* Canvas Columns Skeleton */}
        <div className="flex-1 overflow-x-auto p-6 flex gap-4 min-h-[500px] bg-secondary/10 animate-pulse">
          {[1, 2, 3, 4].map(col => (
            <div
              key={col}
              className="w-72 shrink-0 rounded-xl border bg-card/60 p-4 flex flex-col gap-3 shadow-xs"
            >
              <div className="h-4 w-28 bg-secondary/80 rounded" />
              <div className="h-20 w-full bg-secondary/60 rounded-lg" />
              <div className="h-24 w-full bg-secondary/60 rounded-lg" />
              <div className="h-16 w-full bg-secondary/60 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error states
  if (isError) {
    const axiosErr = error as { response?: { status?: number; data?: { error?: string } } } | undefined;
    const status = axiosErr?.response?.status;

    // 404: Board Not Found
    if (status === 404) {
      return (
        <div
          data-testid="canvas-error-404"
          className="flex flex-1 flex-col items-center justify-center p-6 text-center min-h-[60vh]"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
            <FileQuestion className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Board Not Found
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            The board you are trying to access does not exist or may have been deleted.
          </p>
          <Button
            onClick={() => navigate("/")}
            className="mt-6 gap-2"
            data-testid="return-dashboard-button"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to Dashboard
          </Button>
        </div>
      );
    }

    // 403: Forbidden / Access Denied
    if (status === 403) {
      return (
        <div
          data-testid="canvas-error-403"
          className="flex flex-1 flex-col items-center justify-center p-6 text-center min-h-[60vh]"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-4">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Access Denied
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            You do not have permission to access this board. Ensure you have accepted an invitation to the organization.
          </p>
          <Button
            onClick={() => navigate("/")}
            className="mt-6 gap-2"
            data-testid="return-dashboard-button"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to Dashboard
          </Button>
        </div>
      );
    }

    // Generic Error Fallback
    return (
      <div
        data-testid="canvas-error-generic"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center min-h-[60vh]"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Error Loading Board
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          {getBoardErrorMessage(error, "An unexpected error occurred while loading board data.")}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Button variant="outline" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
          <Button onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!board) {
    return null;
  }

  // Successful state: Board canvas viewport
  return (
    <div className="flex flex-col flex-1 h-[calc(100vh-4rem)] overflow-hidden bg-background">
      {/* Board Canvas Header */}
      <BoardHeader board={board} />

      {/* Horizontal Scrollable Canvas Viewport Container */}
      <main
        className="flex-1 overflow-x-auto p-6 flex gap-4 min-h-[500px] bg-secondary/10"
        data-testid="board-canvas-viewport"
        aria-label="Kanban Canvas"
      >
        {board.section && board.section.length > 0 ? (
          board.section.map(sec => (
            <section
              key={sec.id}
              className="w-72 shrink-0 rounded-xl border bg-card/90 shadow-sm p-4 flex flex-col gap-3"
              data-testid={`column-${sec.id}`}
            >
              <div className="flex items-center justify-between font-semibold text-sm">
                <span className="truncate">{sec.title}</span>
                <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded-full bg-secondary">
                  {sec.issues?.length ?? 0}
                </span>
              </div>
              <div className="flex-1 flex flex-col gap-2 min-h-[100px]">
                {sec.issues && sec.issues.length > 0 ? (
                  sec.issues.map(issue => (
                    <article
                      key={issue.id}
                      className="rounded-lg border bg-background p-3 shadow-xs text-xs font-medium hover:border-primary/40 transition-colors"
                      data-testid={`card-${issue.id}`}
                    >
                      <h4 className="line-clamp-2">{issue.title}</h4>
                    </article>
                  ))
                ) : (
                  <div className="flex items-center justify-center p-4 border border-dashed rounded-lg text-xs text-muted-foreground/60 italic">
                    No cards in column
                  </div>
                )}
              </div>
            </section>
          ))
        ) : (
          <div
            data-testid="canvas-empty-columns"
            className="flex flex-col items-center justify-center m-auto text-center p-8 rounded-xl border border-dashed border-border/80 bg-card/40 max-w-md"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
              <Kanban className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              Canvas Ready
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This board has no columns yet. Columns, drag-and-drop, and card interactions will be configured in Step 5.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
