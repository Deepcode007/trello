import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ShieldAlert,
  ArrowLeft,
  FileQuestion,
  RefreshCw
} from "lucide-react";
import { useOrgStore } from "../store/useOrgStore";
import { useBoardSocket } from "../hooks/useBoardSocket";
import { useBoardDetailsQuery } from "../hooks/useBoardQueries";
import { BoardHeader } from "../components/board/BoardHeader";
import { KanbanCanvas } from "../components/board/KanbanCanvas";
import { CardDetailModal } from "../components/board/CardDetailModal/CardDetailModal";
import { Button } from "../components/ui/button";
import { getBoardErrorMessage } from "../lib/board-api";

export function BoardCanvasPage() {
  const { orgId, boardId } = useParams<{ orgId: string; boardId: string }>();
  const navigate = useNavigate();
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const setActiveOrgId = useOrgStore(s => s.setActiveOrgId);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

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

      {/* Modular Kanban Canvas */}
      <KanbanCanvas
        board={board}
        onSelectCard={setSelectedIssueId}
      />

      {/* Card Detail Modal */}
      <CardDetailModal
        issueId={selectedIssueId}
        open={Boolean(selectedIssueId)}
        onOpenChange={open => !open && setSelectedIssueId(null)}
        boardId={board.id}
        orgId={board.orgId}
        allSections={board.section || []}
      />
    </div>
  );
}
