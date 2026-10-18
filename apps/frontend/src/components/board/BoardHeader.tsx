import React, { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  Settings2,
  Loader2,
  Building2
} from "lucide-react";
import { useOrgStore } from "../../store/useOrgStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useBoardStore } from "../../store/useBoardStore";
import { useRole } from "../../hooks/useRole";
import { boardApi, type BoardSummary, type BoardDetail } from "../../lib/board-api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Avatar } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from "../ui/dropdown-menu";
import { EditBoardModal } from "./EditBoardModal";
import { DeleteBoardDialog } from "./DeleteBoardDialog";

export interface BoardHeaderProps {
  board: BoardDetail | BoardSummary;
}

export function BoardHeader({ board }: BoardHeaderProps) {
  const queryClient = useQueryClient();
  const orgMemberships = useOrgStore(s => s.memberships);
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const currentUser = useAuthStore(s => s.user);
  const collaboratorsMap = useBoardStore(s => s.collaborators);
  const connectionStatus = useBoardStore(s => s.connectionStatus);

  const { canEditBoard, canDeleteBoard } = useRole(board.orgId || activeOrgId || undefined);

  // Determine Organization Name for breadcrumbs
  const orgName = useMemo(() => {
    const targetId = board.orgId || activeOrgId;
    const match = orgMemberships.find(m => m.orgId === targetId);
    return match?.org?.name || "Organization";
  }, [board.orgId, activeOrgId, orgMemberships]);

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleValue, setTitleValue] = useState(board.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Modals state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Sync title value if board.title updates externally
  useEffect(() => {
    setTitleValue(board.title);
  }, [board.title]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  const handleSaveTitle = async () => {
    if (isSavingTitle) return;
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === board.title) {
      setTitleValue(board.title);
      setIsRenaming(false);
      return;
    }

    setIsSavingTitle(true);
    try {
      await boardApi.updateBoard(board.id, { title: trimmed });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["board", board.id] }),
        queryClient.invalidateQueries({ queryKey: ["boards", board.orgId] })
      ]);
    } catch (err) {
      console.error("Failed to rename board:", err);
      setTitleValue(board.title);
    } finally {
      setIsSavingTitle(false);
      setIsRenaming(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === "Escape") {
      setTitleValue(board.title);
      setIsRenaming(false);
    }
  };

  const handleToggleArchive = async () => {
    try {
      await boardApi.updateBoard(board.id, { isArchived: !board.isArchived });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["board", board.id] }),
        queryClient.invalidateQueries({ queryKey: ["boards", board.orgId] })
      ]);
    } catch (err) {
      console.error("Failed to toggle archive status:", err);
    }
  };

  // Build active collaborators list (current user + socket collaborators)
  const activeCollaborators = useMemo(() => {
    const list: Array<{ userId: string; name?: string; email?: string }> = [];
    const seen = new Set<string>();

    if (currentUser?.id) {
      seen.add(currentUser.id);
      list.push({
        userId: currentUser.id,
        name: currentUser.name || currentUser.username,
        email: currentUser.email
      });
    }

    for (const c of Object.values(collaboratorsMap)) {
      if (!seen.has(c.userId)) {
        seen.add(c.userId);
        list.push(c);
      }
    }

    return list;
  }, [collaboratorsMap, currentUser]);

  const displayedCollaborators = activeCollaborators.slice(0, 5);
  const overflowCount = Math.max(0, activeCollaborators.length - 5);

  return (
    <header className="border-b bg-card/60 backdrop-blur px-6 py-4 shadow-sm" data-testid="board-header">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Left Side: Breadcrumb & Title */}
        <div className="space-y-1">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link
              to="/"
              className="flex items-center gap-1 transition-colors hover:text-foreground font-medium"
              data-testid="breadcrumb-org-link"
            >
              <Building2 className="h-3 w-3 text-muted-foreground/80" />
              <span>{orgName}</span>
            </Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="font-medium text-foreground truncate max-w-[200px]" data-testid="breadcrumb-board-title">
              {board.title}
            </span>
          </nav>

          {/* Board Title & Inline Rename */}
          <div className="flex items-center gap-2.5">
            {/* Color Accent Indicator */}
            <span
              className="h-3.5 w-3.5 rounded-full shrink-0 ring-1 ring-border/50"
              style={{ backgroundColor: board.color || "#3b82f6" }}
              data-testid="board-color-indicator"
            />

            {isRenaming && canEditBoard ? (
              <div className="flex items-center gap-1.5">
                <Input
                  ref={renameInputRef}
                  value={titleValue}
                  onChange={e => setTitleValue(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={handleTitleKeyDown}
                  disabled={isSavingTitle}
                  className="h-8 text-lg font-bold tracking-tight w-64 max-w-full"
                  data-testid="board-rename-input"
                />
                {isSavingTitle && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1
                  onClick={() => canEditBoard && setIsRenaming(true)}
                  className={`text-xl font-bold tracking-tight text-foreground ${
                    canEditBoard ? "cursor-pointer hover:text-primary transition-colors" : ""
                  }`}
                  data-testid="board-title-heading"
                >
                  {board.title}
                </h1>

                {canEditBoard && (
                  <button
                    type="button"
                    onClick={() => setIsRenaming(true)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                    aria-label="Rename board"
                    data-testid="inline-rename-trigger"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}

                {board.isArchived && (
                  <Badge variant="secondary" className="gap-1 text-xs bg-muted/80 text-muted-foreground shrink-0">
                    <Archive className="h-3 w-3" />
                    Archived
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Presence Stack, Connection Badge & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Real-Time Collaborator Presence Stack */}
          <div
            className="flex items-center -space-x-2 overflow-hidden py-0.5"
            aria-label="Active Collaborators"
            data-testid="collaborator-avatar-stack"
          >
            {displayedCollaborators.map(collaborator => (
              <Avatar
                key={collaborator.userId}
                name={collaborator.name}
                email={collaborator.email}
                size="md"
                className="ring-2 ring-background hover:z-10 transition-transform hover:scale-105 cursor-pointer"
                data-testid={`collaborator-avatar-${collaborator.userId}`}
              />
            ))}

            {overflowCount > 0 && (
              <div
                className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground ring-2 ring-background"
                title={`${overflowCount} more collaborator${overflowCount > 1 ? "s" : ""}`}
                data-testid="collaborator-overflow-badge"
              >
                +{overflowCount}
              </div>
            )}
          </div>

          {/* Connection Status Badge */}
          <div data-testid="connection-status-badge">
            {connectionStatus === "connected" && (
              <div
                data-testid="connection-badge-connected"
                className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Connected</span>
              </div>
            )}
            {connectionStatus === "reconnecting" && (
              <div
                data-testid="connection-badge-reconnecting"
                className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                <span>Reconnecting...</span>
              </div>
            )}
            {connectionStatus === "disconnected" && (
              <div
                data-testid="connection-badge-disconnected"
                className="flex items-center gap-1.5 rounded-full border border-muted-foreground/20 bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span>Disconnected</span>
              </div>
            )}
          </div>

          {/* Board Actions Menu (Gated for admin and employee) */}
          {canEditBoard && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label="Board settings and actions"
                  data-testid="board-actions-trigger"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => setEditModalOpen(true)}
                  className="gap-2 cursor-pointer text-xs"
                  data-testid="action-edit-board"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Edit Details
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={handleToggleArchive}
                  className="gap-2 cursor-pointer text-xs"
                  data-testid="action-toggle-archive"
                >
                  {board.isArchived ? (
                    <>
                      <ArchiveRestore className="h-3.5 w-3.5" />
                      Unarchive Board
                    </>
                  ) : (
                    <>
                      <Archive className="h-3.5 w-3.5" />
                      Archive Board
                    </>
                  )}
                </DropdownMenuItem>

                {canDeleteBoard && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteDialogOpen(true)}
                      className="gap-2 cursor-pointer text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
                      data-testid="action-delete-board"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Board
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Edit Details Modal */}
      <EditBoardModal
        board={board}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
      />

      {/* Delete Board Confirmation Dialog */}
      <DeleteBoardDialog
        board={board}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </header>
  );
}
