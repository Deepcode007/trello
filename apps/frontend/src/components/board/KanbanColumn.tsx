import React, { useState } from "react";
import {
  MoreVertical,
  Plus,
  AlertTriangle,
  Edit3,
  Trash2,
  X,
  Loader2
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { KanbanCard } from "./KanbanCard";
import { EditColumnModal } from "./EditColumnModal";
import { DeleteColumnModal } from "./DeleteColumnModal";
import { useRole } from "../../hooks/useRole";
import { useCreateIssueMutation } from "../../hooks/useKanbanQueries";
import { getKanbanErrorMessage } from "../../lib/kanban-api";
import type { BoardSection } from "../../lib/board-api";

export interface KanbanColumnProps {
  section: BoardSection;
  boardId: string;
  orgId?: string;
  allSections: BoardSection[];
  onSelectCard?: (issueId: string) => void;
}

export function KanbanColumn({
  section,
  boardId,
  orgId,
  allSections,
  onSelectCard
}: KanbanColumnProps) {
  const { isAdmin, canEditBoard } = useRole(orgId);
  const createIssueMutation = useCreateIssueMutation(boardId);

  const [isAddingCard, setIsAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [addCardError, setAddCardError] = useState<string | null>(null);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const cardCount = section.issues?.length ?? 0;
  const isWipExceeded =
    section.wipLimit !== null &&
    section.wipLimit !== undefined &&
    cardCount > section.wipLimit;

  // Defensive sorting of issues by position, createdAt, id
  const sortedIssues = [...(section.issues || [])].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (a.createdAt && b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCardTitle.trim();
    if (!trimmed) return;

    setAddCardError(null);
    try {
      await createIssueMutation.mutateAsync({
        sectionId: section.id,
        payload: { title: trimmed }
      });
      setNewCardTitle("");
      setIsAddingCard(false);
    } catch (err: unknown) {
      setAddCardError(getKanbanErrorMessage(err, "Failed to create card"));
    }
  };

  return (
    <>
      <section
        data-testid={`column-${section.id}`}
        className={`w-72 shrink-0 rounded-xl border bg-card/90 shadow-sm p-4 flex flex-col gap-3 transition-colors ${
          isWipExceeded
            ? "border-destructive/60 bg-destructive/5 ring-1 ring-destructive/20"
            : "border-border/80"
        }`}
      >
        {/* Column Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-sm truncate text-foreground">
              {section.title}
            </h3>

            {/* WIP Limit / Card Count Badge */}
            {isWipExceeded ? (
              <span
                data-testid="wip-limit-warning"
                className="text-xs font-semibold px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 flex items-center gap-1 shrink-0"
                title={`WIP Limit exceeded (${cardCount} / ${section.wipLimit})`}
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  {cardCount} / {section.wipLimit}
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded-full bg-secondary shrink-0">
                {cardCount}
                {section.wipLimit !== null && section.wipLimit !== undefined
                  ? ` / ${section.wipLimit}`
                  : ""}
              </span>
            )}
          </div>

          {/* Column Actions Dropdown */}
          {canEditBoard && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`column-menu-trigger-${section.id}`}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Column actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => setIsEditModalOpen(true)}
                  className="cursor-pointer gap-2"
                  data-testid="edit-column-action"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Column
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                      data-testid="delete-column-action"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Column
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Cards Container */}
        <div className="flex-1 flex flex-col gap-2 min-h-[100px] overflow-y-auto">
          {sortedIssues.length > 0 ? (
            sortedIssues.map(issue => (
              <KanbanCard
                key={issue.id}
                issue={issue}
                onClick={() => onSelectCard?.(issue.id)}
              />
            ))
          ) : (
            <div className="flex items-center justify-center p-4 border border-dashed rounded-lg text-xs text-muted-foreground/60 italic">
              No cards in column
            </div>
          )}
        </div>

        {/* Quick Card Creation */}
        <div className="pt-1 border-t border-border/40">
          {isAddingCard ? (
            <form onSubmit={handleQuickAddSubmit} className="space-y-2">
              <Input
                data-testid="quick-add-card-input"
                placeholder="Enter a title for this card..."
                value={newCardTitle}
                onChange={e => setNewCardTitle(e.target.value)}
                disabled={createIssueMutation.isPending}
                autoFocus
                className="text-xs h-8"
              />
              {addCardError && (
                <p className="text-[11px] text-destructive">{addCardError}</p>
              )}
              <div className="flex items-center gap-1.5">
                <Button
                  type="submit"
                  size="sm"
                  data-testid="quick-add-card-submit"
                  disabled={createIssueMutation.isPending || !newCardTitle.trim()}
                  className="h-7 text-xs px-2.5 gap-1"
                >
                  {createIssueMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Add Card"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="quick-add-card-cancel"
                  onClick={() => {
                    setIsAddingCard(false);
                    setNewCardTitle("");
                    setAddCardError(null);
                  }}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`add-card-button-${section.id}`}
              onClick={() => setIsAddingCard(true)}
              className="w-full justify-start text-xs text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2"
            >
              <Plus className="h-3.5 w-3.5" />
              Add a card
            </Button>
          )}
        </div>
      </section>

      {/* Edit Column Modal */}
      <EditColumnModal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        boardId={boardId}
        section={section}
      />

      {/* Delete Column Modal */}
      <DeleteColumnModal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        boardId={boardId}
        orgId={orgId}
        section={section}
        allSections={allSections}
      />
    </>
  );
}
