import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { useRole } from "../../hooks/useRole";
import { boardApi, getBoardErrorMessage, type BoardSummary } from "../../lib/board-api";
import { Kanban, AlertCircle, Loader2, Check } from "lucide-react";

export const DEFAULT_BOARD_COLOR = "#3b82f6";

export const BOARD_COLOR_PRESETS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Emerald", value: "#10b981" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Indigo", value: "#6366f1" }
];

export interface CreateBoardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSuccess?: (board: BoardSummary) => void;
}

export function CreateBoardModal({
  open,
  onOpenChange,
  orgId,
  onSuccess
}: CreateBoardModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canCreateBoard } = useRole(orgId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_BOARD_COLOR);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields whenever dialog opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setColor(DEFAULT_BOARD_COLOR);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canCreateBoard) {
      setError("You do not have permission to create boards in this organization.");
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Board title is required.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const newBoard = await boardApi.createBoard(orgId, {
        title: trimmedTitle,
        description: description.trim() || undefined,
        color
      });

      // Invalidate queries and navigate
      await queryClient.invalidateQueries({ queryKey: ["boards", orgId] });
      onOpenChange(false);
      onSuccess?.(newBoard);
      navigate(`/orgs/${orgId}/boards/${newBoard.id}`);
    } catch (err: unknown) {
      setError(getBoardErrorMessage(err, "Failed to create board"));
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
              <Kanban className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Create Board</DialogTitle>
              <DialogDescription className="mt-0.5">
                Set up a new kanban board for tracking tasks and workflows.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!canCreateBoard && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              Only organization admins and employees can create boards. Contributors have read-only access.
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
            <Label htmlFor="board-title" required>
              Board Title
            </Label>
            <Input
              id="board-title"
              placeholder="e.g. Sprint Backlog, Engineering Roadmap"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={isSubmitting || !canCreateBoard}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="board-description">
              Description (optional)
            </Label>
            <Input
              id="board-description"
              placeholder="Brief description of the board's purpose"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={isSubmitting || !canCreateBoard}
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
                    disabled={isSubmitting || !canCreateBoard}
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
              disabled={isSubmitting || !canCreateBoard}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Board"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
