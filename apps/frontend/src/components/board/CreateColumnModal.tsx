import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useRole } from "../../hooks/useRole";
import { useCreateSectionMutation } from "../../hooks/useKanbanQueries";
import { getKanbanErrorMessage } from "../../lib/kanban-api";
import type { BoardSection } from "../../lib/board-api";
import { Columns, AlertCircle, Loader2 } from "lucide-react";

export interface CreateColumnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  orgId?: string;
  onSuccess?: (section: BoardSection) => void;
}

export function CreateColumnModal({
  open,
  onOpenChange,
  boardId,
  orgId,
  onSuccess
}: CreateColumnModalProps) {
  const { canEditBoard } = useRole(orgId);
  const createSectionMutation = useCreateSectionMutation(boardId);

  const [title, setTitle] = useState("");
  const [wipLimit, setWipLimit] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setWipLimit("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canEditBoard) {
      setError("Only organization admins and employees can create columns.");
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Column title is required.");
      return;
    }

    let parsedWipLimit: number | null = null;
    if (wipLimit.trim()) {
      const parsed = parseInt(wipLimit.trim(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        setError("WIP limit must be a positive integer.");
        return;
      }
      parsedWipLimit = parsed;
    }

    setError(null);

    try {
      const newSection = await createSectionMutation.mutateAsync({
        title: trimmedTitle,
        wipLimit: parsedWipLimit
      });

      onOpenChange(false);
      onSuccess?.(newSection);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to create column"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="create-column-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Columns className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Add Column</DialogTitle>
              <DialogDescription className="mt-0.5">
                Add a new workflow column to this board.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!canEditBoard && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              Only organization admins and employees can add columns. Contributors have read-only access.
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

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="create-column-title" required>
              Column Title
            </Label>
            <Input
              id="create-column-title"
              data-testid="create-column-title-input"
              placeholder="e.g. In Progress, Review, Done"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={createSectionMutation.isPending || !canEditBoard}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-column-wip">
              WIP Limit (optional)
            </Label>
            <Input
              id="create-column-wip"
              data-testid="create-column-wip-input"
              type="number"
              min="1"
              step="1"
              placeholder="Maximum number of active cards (e.g. 5)"
              value={wipLimit}
              onChange={e => setWipLimit(e.target.value)}
              disabled={createSectionMutation.isPending || !canEditBoard}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createSectionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="create-column-submit-button"
              disabled={createSectionMutation.isPending || !canEditBoard}
              className="gap-1.5"
            >
              {createSectionMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Add Column"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
