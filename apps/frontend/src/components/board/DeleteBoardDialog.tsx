import React, { useState } from "react";
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
import { boardApi, getBoardErrorMessage, type BoardSummary, type BoardDetail } from "../../lib/board-api";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";

export interface DeleteBoardDialogProps {
  board: BoardSummary | BoardDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DeleteBoardDialog({
  board,
  open,
  onOpenChange,
  onSuccess
}: DeleteBoardDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    setIsDeleting(true);

    try {
      await boardApi.deleteBoard(board.id);

      // Clean up cache
      queryClient.removeQueries({ queryKey: ["board", board.id] });
      await queryClient.invalidateQueries({ queryKey: ["boards", board.orgId] });

      onOpenChange(false);
      onSuccess?.();
      navigate("/");
    } catch (err: unknown) {
      setError(getBoardErrorMessage(err, "Failed to delete board"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-destructive">Delete Board</DialogTitle>
              <DialogDescription className="mt-0.5">
                This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <div className="space-y-3 py-2 text-sm text-muted-foreground">
          <p>
            Are you sure you want to permanently delete the board{" "}
            <strong className="text-foreground">&quot;{board.title}&quot;</strong>?
          </p>
          <p className="text-xs text-destructive/90 bg-destructive/5 border border-destructive/20 rounded-md p-2.5 leading-relaxed">
            All columns, cards, labels, checklists, and comments on this board will be permanently removed.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting}
            className="gap-1.5"
            data-testid="confirm-delete-board-button"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                Delete Board
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
