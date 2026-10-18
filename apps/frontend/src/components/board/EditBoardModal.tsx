import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { BOARD_COLOR_PRESETS, DEFAULT_BOARD_COLOR } from "./CreateBoardModal";
import { boardApi, getBoardErrorMessage, type BoardSummary, type BoardDetail } from "../../lib/board-api";
import { Settings2, AlertCircle, Loader2, Check } from "lucide-react";

export interface EditBoardModalProps {
  board: BoardSummary | BoardDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (updated: BoardSummary) => void;
}

export function EditBoardModal({
  board,
  open,
  onOpenChange,
  onSuccess
}: EditBoardModalProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description || "");
  const [color, setColor] = useState(board.color || DEFAULT_BOARD_COLOR);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state whenever dialog opens or board changes
  useEffect(() => {
    if (open) {
      setTitle(board.title);
      setDescription(board.description || "");
      setColor(board.color || DEFAULT_BOARD_COLOR);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, board]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Board title is required.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const updated = await boardApi.updateBoard(board.id, {
        title: trimmedTitle,
        description: description.trim() || undefined,
        color
      });

      // Invalidate queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["board", board.id] }),
        queryClient.invalidateQueries({ queryKey: ["boards", board.orgId] })
      ]);

      onOpenChange(false);
      onSuccess?.(updated);
    } catch (err: unknown) {
      setError(getBoardErrorMessage(err, "Failed to update board"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Edit Board Details</DialogTitle>
              <DialogDescription className="mt-0.5">
                Update the title, description, and visual theme for this board.
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
            <Label htmlFor="edit-board-title" required>
              Board Title
            </Label>
            <Input
              id="edit-board-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-board-description">
              Description (optional)
            </Label>
            <Input
              id="edit-board-description"
              placeholder="Brief description of the board's purpose"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2 pt-1">
            <Label>Color Accent</Label>
            <div className="flex items-center gap-3">
              {BOARD_COLOR_PRESETS.map(preset => {
                const isSelected = color === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    aria-label={`Select ${preset.name} color`}
                    onClick={() => setColor(preset.value)}
                    disabled={isSubmitting}
                    style={{ backgroundColor: preset.value }}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      isSelected ? "ring-2 ring-primary ring-offset-2 scale-105" : "opacity-90 hover:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-4 w-4 text-white stroke-[2.5]" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? (
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
