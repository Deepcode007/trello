import React, { useState } from "react";
import { Tag, Plus, X, Check, Loader2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  useBoardLabelsQuery,
  useCreateBoardLabelMutation,
  useAttachLabelMutation,
  useDetachLabelMutation
} from "../../../hooks/useKanbanQueries";
import { getKanbanErrorMessage, type IssueLabelItem } from "../../../lib/kanban-api";

export const LABEL_COLOR_PRESETS = [
  { name: "Red", value: "#ef4444" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Emerald", value: "#10b981" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Pink", value: "#ec4899" }
];

export interface CardLabelsSectionProps {
  boardId: string;
  issueId: string;
  attachedLabels?: IssueLabelItem[];
  canEdit: boolean;
}

export function CardLabelsSection({
  boardId,
  issueId,
  attachedLabels = [],
  canEdit
}: CardLabelsSectionProps) {
  const { data: boardLabels = [] } = useBoardLabelsQuery(boardId);
  const attachMutation = useAttachLabelMutation(boardId, issueId);
  const detachMutation = useDetachLabelMutation(boardId, issueId);
  const createLabelMutation = useCreateBoardLabelMutation(boardId);

  const [isOpen, setIsOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [selectedColor, setSelectedColor] = useState(LABEL_COLOR_PRESETS[0]!.value);
  const [error, setError] = useState<string | null>(null);

  const attachedLabelIds = new Set(
    attachedLabels.map(l => l.label?.id || l.labelId).filter(Boolean)
  );

  const handleAttach = async (labelId: string) => {
    setError(null);
    try {
      await attachMutation.mutateAsync(labelId);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to attach label"));
    }
  };

  const handleDetach = async (labelId: string) => {
    setError(null);
    try {
      await detachMutation.mutateAsync(labelId);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to detach label"));
    }
  };

  const handleCreateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newLabelName.trim();
    if (!trimmed) return;

    setError(null);
    try {
      const created = await createLabelMutation.mutateAsync({
        name: trimmed,
        color: selectedColor
      });
      // Immediately attach the newly created label
      await attachMutation.mutateAsync(created.id);
      setNewLabelName("");
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to create label"));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Tag className="h-3.5 w-3.5" />
          <span>Labels</span>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="add-label-trigger"
            onClick={() => setIsOpen(!isOpen)}
            className="h-6 text-xs px-2 gap-1 text-primary hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            {isOpen ? "Close" : "Add Label"}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}

      {/* Attached Label Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {attachedLabels.length > 0 ? (
          attachedLabels.map(item => {
            const label = item.label;
            if (!label) return null;
            return (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-white shadow-2xs"
                style={{ backgroundColor: label.color }}
              >
                <span>{label.name}</span>
                {canEdit && (
                  <button
                    type="button"
                    data-testid={`detach-label-${label.id}`}
                    onClick={() => handleDetach(label.id)}
                    className="hover:opacity-80 rounded-full p-0.5 focus:outline-none"
                    title={`Remove label ${label.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-muted-foreground italic">No labels attached</span>
        )}
      </div>

      {/* Label Picker & Creator Popover */}
      {isOpen && canEdit && (
        <div className="mt-2 rounded-lg border bg-card p-3 shadow-md space-y-3">
          <div className="text-xs font-medium text-foreground">Select or create label</div>

          {/* Existing Board Labels List */}
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {boardLabels.length > 0 ? (
              boardLabels.map(label => {
                const isAttached = attachedLabelIds.has(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    data-testid={`attach-label-${label.id}`}
                    onClick={() => (isAttached ? handleDetach(label.id) : handleAttach(label.id))}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-xs text-left hover:bg-secondary/60 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="font-medium text-foreground">{label.name}</span>
                    </div>
                    {isAttached && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground italic">No labels on this board yet.</p>
            )}
          </div>

          {/* Create New Label Sub-form */}
          <form onSubmit={handleCreateLabel} className="pt-2 border-t border-border/40 space-y-2">
            <Input
              data-testid="new-label-name-input"
              placeholder="New label name..."
              value={newLabelName}
              onChange={e => setNewLabelName(e.target.value)}
              disabled={createLabelMutation.isPending}
              className="text-xs h-8"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {LABEL_COLOR_PRESETS.map(preset => {
                  const isSelected = selectedColor === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setSelectedColor(preset.value)}
                      style={{ backgroundColor: preset.value }}
                      className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                        isSelected ? "ring-2 ring-primary ring-offset-1 scale-110" : ""
                      }`}
                      title={preset.name}
                    />
                  );
                })}
              </div>

              <Button
                type="submit"
                size="sm"
                data-testid="create-label-submit-button"
                disabled={createLabelMutation.isPending || !newLabelName.trim()}
                className="h-7 text-xs px-2.5 gap-1"
              >
                {createLabelMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
