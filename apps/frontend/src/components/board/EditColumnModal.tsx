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
import { useUpdateSectionMutation } from "../../hooks/useKanbanQueries";
import { getKanbanErrorMessage } from "../../lib/kanban-api";
import type { BoardSection } from "../../lib/board-api";
import { Edit3, AlertCircle, Loader2 } from "lucide-react";

export interface EditColumnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  section: BoardSection;
  onSuccess?: (section: BoardSection) => void;
}

export function EditColumnModal({
  open,
  onOpenChange,
  boardId,
  section,
  onSuccess
}: EditColumnModalProps) {
  const updateSectionMutation = useUpdateSectionMutation(boardId);

  const [title, setTitle] = useState(section.title);
  const [wipLimit, setWipLimit] = useState<string>(
    section.wipLimit !== null && section.wipLimit !== undefined
      ? String(section.wipLimit)
      : ""
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(section.title);
      setWipLimit(
        section.wipLimit !== null && section.wipLimit !== undefined
          ? String(section.wipLimit)
          : ""
      );
      setError(null);
    }
  }, [open, section]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
      const updatedSection = await updateSectionMutation.mutateAsync({
        sectionId: section.id,
        updates: {
          title: trimmedTitle,
          wipLimit: parsedWipLimit
        }
      });

      onOpenChange(false);
      onSuccess?.(updatedSection);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update column"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="edit-column-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Edit3 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Edit Column</DialogTitle>
              <DialogDescription className="mt-0.5">
                Update column title or configure WIP (Work In Progress) limit.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

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
            <Label htmlFor="edit-column-title" required>
              Column Title
            </Label>
            <Input
              id="edit-column-title"
              data-testid="edit-column-title-input"
              placeholder="Column title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={updateSectionMutation.isPending}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-column-wip">
              WIP Limit (leave blank for unlimited)
            </Label>
            <Input
              id="edit-column-wip"
              data-testid="edit-column-wip-input"
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 5 (or empty to clear)"
              value={wipLimit}
              onChange={e => setWipLimit(e.target.value)}
              disabled={updateSectionMutation.isPending}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={updateSectionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="edit-column-submit-button"
              disabled={updateSectionMutation.isPending}
              className="gap-1.5"
            >
              {updateSectionMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
