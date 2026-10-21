import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { orgApi, type OrgMemberItem } from "../../lib/org-api";
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
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { EditBoardModal } from "./EditBoardModal";
import { DeleteBoardDialog } from "./DeleteBoardDialog";

export const formatRank = (rank?: string): string => {
  const trimmed = rank?.trim();
  if (!trimmed) return "Member";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

const isEmailLike = (val?: string | null): boolean => Boolean(val && val.includes("@"));

export const getDisplayName = (user?: {
  name?: string | null;
  username?: string | null;
  email?: string | null;
}): string => {
  if (!user) return "Collaborator";
  const name = user.name?.trim();
  if (name && !isEmailLike(name)) {
    return name;
  }
  const username = user.username?.trim();
  if (username && !isEmailLike(username)) {
    return username;
  }
  const email = user.email?.trim();
  if (email && email.includes("@")) {
    return email.split("@")[0]!;
  }
  return name || username || "Collaborator";
};

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

  const targetOrgId = board.orgId || activeOrgId;

  const { data: orgMembers = [] } = useQuery<OrgMemberItem[]>({
    queryKey: ["orgMembers", targetOrgId],
    queryFn: () => orgApi.getOrgMembers(targetOrgId!),
    enabled: Boolean(targetOrgId)
  });

  const findOrgMember = useCallback((c: { userId?: string | null; email?: string | null; name?: string | null }): OrgMemberItem | undefined => {
    if (orgMembers.length === 0) return undefined;
    const cleanUid = c.userId?.trim();
    const cleanEmail = c.email?.trim().toLowerCase();
    const cleanName = c.name?.trim().toLowerCase();

    return orgMembers.find(m => {
      if (cleanUid && ((m.userId && m.userId === cleanUid) || (m.user?.id && m.user.id === cleanUid))) {
        return true;
      }
      if (cleanEmail && m.user?.email?.toLowerCase() === cleanEmail) {
        return true;
      }
      if (cleanName && m.user?.username?.toLowerCase() === cleanName) {
        return true;
      }
      if (cleanName && m.user?.name && m.user.name.toLowerCase() === cleanName) {
        return true;
      }
      if (cleanName && m.user?.email && m.user.email.toLowerCase().split("@")[0] === cleanName) {
        return true;
      }
      return false;
    });
  }, [orgMembers]);

  const getCollaboratorName = useCallback((c: { userId: string; name?: string | null; email?: string | null }): string => {
    if (currentUser?.id && c.userId === currentUser.id) {
      const myEmailPrefix = currentUser.email?.includes("@") ? currentUser.email.split("@")[0] : null;
      const myName = currentUser.name?.trim();
      if (myName && !isEmailLike(myName) && myName !== myEmailPrefix) {
        return myName;
      }
    }

    const member = findOrgMember(c);
    if (member?.user) {
      const memName = member.user.name?.trim();
      if (memName && !isEmailLike(memName)) {
        return memName;
      }
      const memUsername = member.user.username?.trim();
      if (memUsername && !isEmailLike(memUsername)) {
        const socketName = c.name?.trim();
        const socketEmail = c.email?.trim().toLowerCase() || member.user.email?.toLowerCase();
        const emailPrefix = socketEmail && socketEmail.includes("@") ? socketEmail.split("@")[0] : null;

        if (socketName && !isEmailLike(socketName) && socketName !== emailPrefix) {
          return socketName;
        }
        return memUsername;
      }
    }

    const socketName = c.name?.trim();
    const socketEmail = c.email?.trim().toLowerCase();
    const emailPrefix = socketEmail && socketEmail.includes("@") ? socketEmail.split("@")[0] : null;

    if (socketName && !isEmailLike(socketName) && socketName !== emailPrefix) {
      return socketName;
    }

    return getDisplayName(c);
  }, [currentUser, findOrgMember]);

  const getCollaboratorRank = useCallback((c: { userId: string; email?: string | null; role?: string | null; rank?: string | null; name?: string | null }): string => {
    const rawRole = c.rank || c.role;
    if (rawRole && rawRole.trim()) {
      return formatRank(rawRole);
    }
    if (currentUser?.id && c.userId === currentUser.id) {
      const match = orgMemberships.find(m => m.orgId === targetOrgId);
      if (match?.role) return formatRank(match.role);
    }
    const member = findOrgMember(c);
    if (member?.role) return formatRank(member.role);
    return "Member";
  }, [currentUser, findOrgMember, orgMemberships, targetOrgId]);

  const getCollaboratorEmail = useCallback((c: { userId: string; email?: string | null; name?: string | null }): string => {
    if (c.email && c.email.trim()) return c.email.trim();
    if (currentUser?.id && c.userId === currentUser.id && currentUser.email) {
      return currentUser.email;
    }
    const member = findOrgMember(c);
    if (member?.user?.email) return member.user.email;
    return "No email available";
  }, [currentUser, findOrgMember]);

  // Build active collaborators list (current user + socket collaborators)
  const activeCollaborators = useMemo(() => {
    const list: Array<{ userId: string; name?: string; email?: string; role?: string; rank?: string }> = [];
    const seen = new Set<string>();

    if (currentUser?.id) {
      seen.add(currentUser.id);
      const myDisplayName = getCollaboratorName({
        userId: currentUser.id,
        name: currentUser.name,
        email: currentUser.email
      });
      const myMembership = orgMemberships.find(m => m.orgId === targetOrgId);
      const socketEntry = collaboratorsMap[currentUser.id];
      const role = myMembership?.role || socketEntry?.role || socketEntry?.rank;

      list.push({
        userId: currentUser.id,
        name: myDisplayName,
        email: currentUser.email,
        role,
        rank: role
      });
    }

    for (const c of Object.values(collaboratorsMap)) {
      if (!seen.has(c.userId)) {
        seen.add(c.userId);
        const resolvedName = getCollaboratorName(c);
        const resolvedEmail = getCollaboratorEmail(c);
        const resolvedRole = getCollaboratorRank(c);
        list.push({
          ...c,
          name: resolvedName,
          email: resolvedEmail !== "No email available" ? resolvedEmail : c.email,
          role: c.role || resolvedRole,
          rank: c.rank || resolvedRole
        });
      }
    }

    return list;
  }, [collaboratorsMap, currentUser, orgMemberships, targetOrgId, getCollaboratorName, getCollaboratorEmail, getCollaboratorRank]);

  const displayedCollaborators = activeCollaborators.slice(0, 5);
  const overflowCount = Math.max(0, activeCollaborators.length - 5);

  return (
    <header className="relative z-20 border-b bg-card/60 backdrop-blur px-6 py-4 shadow-sm" data-testid="board-header">
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
            className="flex items-center -space-x-2 py-0.5"
            aria-label="Active Collaborators"
            data-testid="collaborator-avatar-stack"
          >
            {displayedCollaborators.map(collaborator => {
              const displayName = getDisplayName(collaborator);
              const rank = getCollaboratorRank(collaborator);
              const email = getCollaboratorEmail(collaborator);
              return (
                <Popover key={collaborator.userId}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="group relative rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-transform hover:scale-105 hover:z-20 data-[state=open]:z-20 cursor-pointer"
                      aria-label={displayName}
                      title={displayName}
                      data-testid={`collaborator-trigger-${collaborator.userId}`}
                    >
                      <Avatar
                        name={displayName}
                        email={collaborator.email}
                        title={displayName}
                        size="md"
                        className="ring-2 ring-background pointer-events-none"
                        data-testid={`collaborator-avatar-${collaborator.userId}`}
                      />
                      <span
                        role="tooltip"
                        aria-hidden="true"
                        className="pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex group-focus-visible:flex group-data-[state=open]:hidden group-aria-expanded:hidden items-center px-2 py-0.5 rounded bg-popover text-popover-foreground text-xs font-medium border border-border shadow-md whitespace-nowrap z-30"
                        data-testid={`collaborator-hover-name-${collaborator.userId}`}
                      >
                        {displayName}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-64 p-3 shadow-lg border bg-popover text-popover-foreground"
                    align="center"
                    side="bottom"
                    sideOffset={8}
                    data-testid={`collaborator-popover-${collaborator.userId}`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={displayName}
                        email={collaborator.email || (email !== "No email available" ? email : undefined)}
                        size="md"
                        className="ring-1 ring-border shrink-0 mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <h4
                          className="text-sm font-semibold text-foreground truncate"
                          data-testid={`collaborator-popover-name-${collaborator.userId}`}
                        >
                          {displayName}
                        </h4>
                        <p
                          className="text-xs text-muted-foreground truncate"
                          data-testid={`collaborator-popover-email-${collaborator.userId}`}
                        >
                          {email}
                        </p>
                        <div className="pt-1 flex items-center gap-1.5 text-xs">
                          <span className="text-[11px] font-medium text-muted-foreground">Rank:</span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-medium capitalize px-1.5 py-0 h-4 bg-secondary/80 text-secondary-foreground"
                            data-testid={`collaborator-popover-rank-${collaborator.userId}`}
                          >
                            {rank}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })}

            {overflowCount > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground ring-2 ring-background hover:scale-105 hover:z-20 data-[state=open]:z-20 transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    title={`${overflowCount} more collaborator${overflowCount > 1 ? "s" : ""}`}
                    data-testid="collaborator-overflow-badge"
                  >
                    +{overflowCount}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-72 p-3 shadow-lg border bg-popover text-popover-foreground max-h-64 overflow-y-auto"
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  data-testid="collaborator-overflow-popover"
                >
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    Other Connected Users ({overflowCount})
                  </h4>
                  <div className="space-y-2">
                    {activeCollaborators.slice(5).map(collab => {
                      const collabName = getDisplayName(collab);
                      const collabRank = getCollaboratorRank(collab);
                      const collabEmail = getCollaboratorEmail(collab);
                      return (
                        <div
                          key={collab.userId}
                          className="flex items-center gap-2.5 p-1.5 rounded-md hover:bg-muted/50 transition-colors"
                          title={collabName}
                          data-testid={`collaborator-overflow-item-${collab.userId}`}
                        >
                          <Avatar name={collabName} email={collab.email || (collabEmail !== "No email available" ? collabEmail : undefined)} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">
                              {collabName}
                            </p>
                            <p
                              className="text-[11px] text-muted-foreground truncate"
                              data-testid={`collaborator-overflow-email-${collab.userId}`}
                            >
                              {collabEmail}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-muted-foreground">Rank:</span>
                            <Badge
                              variant="secondary"
                              className="text-[10px] capitalize px-1.5 py-0 h-4"
                              data-testid={`collaborator-overflow-rank-${collab.userId}`}
                            >
                              {collabRank}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
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
