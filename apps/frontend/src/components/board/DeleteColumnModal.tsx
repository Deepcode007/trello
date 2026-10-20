import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { useRole } from "../../hooks/useRole";
import { useDeleteSectionMutation } from "../../hooks/useKanbanQueries";
import { getKanbanErrorMessage } from "../../lib/kanban-api";
import type { BoardSection } from "../../lib/board-api";
import { Trash2, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";

export interface DeleteColumnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  orgId?: string;
  section: BoardSection;
  allSections: BoardSection[];
  onSuccess?: () => void;
}

export function DeleteColumnModal({
  open,
  onOpenChange,
  boardId,
  orgId,
  section,
  allSections,
  onSuccess
}: DeleteColumnModalProps) {
  const { isAdmin } = useRole(orgId);
  const deleteSectionMutation = useDeleteSectionMutation(boardId);

  const cardCount = section.issues?.length ?? 0;
  const otherSections = useMemo(
    () => allSections.filter(s => s.id !== section.id),
    [allSections, section.id]
  );

  const [targetSectionId, setTargetSectionId] = useState<string>(
    otherSections[0]?.id || ""
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTargetSectionId(prev => {
        if (prev && otherSections.some(s => s.id === prev)) {
          return prev;
        }
        return otherSections[0]?.id || "";
      });
      setError(null);
    }
  }, [open, otherSections]);

  const cannotDeleteSoleColumnWithCards = cardCount > 0 && otherSections.length === 0;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAdmin) {
      setError("Only organization admins can delete columns.");
      return;
    }

    if (cannotDeleteSoleColumnWithCards) {
      setError("Cannot delete the only column containing cards. Please delete or move cards first.");
      return;
    }

    if (cardCount > 0 && !targetSectionId) {
      setError("A target column is required to reassign existing cards.");
      return;
    }

    setError(null);

    try {
      await deleteSectionMutation.mutateAsync({
        sectionId: section.id,
        targetSectionId: cardCount > 0 ? targetSectionId : undefined
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to delete column"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[460px]"
        data-testid={cardCount > 0 ? "reassign-issues-modal" : "delete-column-dialog"}
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Delete Column</DialogTitle>
              <DialogDescription className="mt-0.5">
                {cardCount > 0
                  ? `Reassign ${cardCount} card${cardCount > 1 ? "s" : ""} and delete "${section.title}"`
                  : `Are you sure you want to delete "${section.title}"?`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!isAdmin && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              Only organization admins can delete columns. Employees and contributors cannot perform column deletion.
            </span>
          </div>
        )}

        {cannotDeleteSoleColumnWithCards && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              Cannot delete the only column containing cards. Please delete or move cards first.
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleDelete} className="space-y-4 pt-1">
          {cardCount > 0 && !cannotDeleteSoleColumnWithCards && (
            <div className="space-y-2">
              <Label htmlFor="target-section-select" required>
                Reassign Cards To
              </Label>
              <select
                id="target-section-select"
                data-testid="target-section-select"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={targetSectionId}
                onChange={e => setTargetSectionId(e.target.value)}
                disabled={deleteSectionMutation.isPending || !isAdmin}
              >
                {otherSections.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                All {cardCount} cards in &quot;{section.title}&quot; will be moved to the selected column before deletion.
              </p>
            </div>
          )}

          {cardCount === 0 && (
            <p className="text-sm text-muted-foreground">
              This column is empty. Deleting it will permanently remove it from the board.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={deleteSectionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              data-testid="confirm-delete-column-button"
              disabled={
                deleteSectionMutation.isPending ||
                !isAdmin ||
                cannotDeleteSoleColumnWithCards ||
                (cardCount > 0 && !targetSectionId)
              }
              className="gap-1.5"
            >
              {deleteSectionMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Column"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
