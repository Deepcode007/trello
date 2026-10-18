import React, { useState } from "react";
import { CheckSquare, Plus, Trash2, X, Loader2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  useCreateChecklistMutation,
  useDeleteChecklistMutation,
  useAddChecklistItemMutation,
  useUpdateChecklistItemMutation
} from "../../../hooks/useKanbanQueries";
import {
  getKanbanErrorMessage,
  type Checklist,
  type ChecklistItem
} from "../../../lib/kanban-api";

export interface CardChecklistsSectionProps {
  boardId: string;
  issueId: string;
  checklists?: Checklist[];
  canEdit: boolean;
}

export function CardChecklistsSection({
  boardId,
  issueId,
  checklists = [],
  canEdit
}: CardChecklistsSectionProps) {
  const createChecklistMutation = useCreateChecklistMutation(boardId, issueId);
  const deleteChecklistMutation = useDeleteChecklistMutation(boardId, issueId);
  const addItemMutation = useAddChecklistItemMutation(boardId, issueId);
  const updateItemMutation = useUpdateChecklistItemMutation(boardId, issueId);

  // New checklist creation state
  const [isAddingChecklist, setIsAddingChecklist] = useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");

  // Adding item states keyed by checklistId
  const [addingItemChecklistId, setAddingItemChecklistId] = useState<string | null>(null);
  const [newItemContent, setNewItemContent] = useState("");

  const [error, setError] = useState<string | null>(null);

  const handleCreateChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newChecklistTitle.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await createChecklistMutation.mutateAsync(trimmed);
      setNewChecklistTitle("");
      setIsAddingChecklist(false);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to create checklist"));
    }
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    setError(null);
    try {
      await deleteChecklistMutation.mutateAsync(checklistId);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to delete checklist"));
    }
  };

  const handleAddItem = async (e: React.FormEvent, checklistId: string) => {
    e.preventDefault();
    const trimmed = newItemContent.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await addItemMutation.mutateAsync({
        checklistId,
        content: trimmed
      });
      setNewItemContent("");
      setAddingItemChecklistId(null);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to add checklist item"));
    }
  };

  const handleToggleItem = async (item: ChecklistItem) => {
    setError(null);
    try {
      await updateItemMutation.mutateAsync({
        itemId: item.id,
        updates: {
          isCompleted: !item.isCompleted
        }
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update item"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <CheckSquare className="h-3.5 w-3.5" />
          <span>Checklists</span>
        </div>
        {canEdit && !isAddingChecklist && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="add-checklist-trigger"
            onClick={() => setIsAddingChecklist(true)}
            className="h-6 text-xs px-2 gap-1 text-primary hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            Add Checklist
          </Button>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}

      {/* Checklists List */}
      <div className="space-y-5">
        {checklists.map(chk => {
          const items = chk.items || [];
          const total = items.length;
          const completed = items.filter(i => i.isCompleted).length;
          const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <div key={chk.id} className="space-y-2 rounded-lg border bg-card/60 p-3 shadow-2xs">
              {/* Checklist Header */}
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-xs text-foreground truncate">
                  {chk.title}
                </span>

                {canEdit && (
                  <button
                    type="button"
                    data-testid={`delete-checklist-${chk.id}`}
                    onClick={() => handleDeleteChecklist(chk.id)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded"
                    title="Delete checklist"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Progress Bar & Ratio */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span data-testid={`checklist-progress-${chk.id}`}>
                    {percentage}% ({completed}/{total})
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-1.5 pt-1">
                {items.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-secondary/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      data-testid={`checklist-item-checkbox-${item.id}`}
                      checked={item.isCompleted}
                      onChange={() => handleToggleItem(item)}
                      disabled={!canEdit || updateItemMutation.isPending}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span
                      className={`flex-1 text-xs ${
                        item.isCompleted
                          ? "line-through text-muted-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {item.content || item.title}
                    </span>
                  </div>
                ))}
              </div>

              {/* Add Item Form */}
              {canEdit && (
                <div className="pt-1">
                  {addingItemChecklistId === chk.id ? (
                    <form
                      onSubmit={e => handleAddItem(e, chk.id)}
                      className="space-y-2 pt-1"
                    >
                      <Input
                        data-testid={`add-item-input-${chk.id}`}
                        placeholder="Add a subtask..."
                        value={newItemContent}
                        onChange={e => setNewItemContent(e.target.value)}
                        disabled={addItemMutation.isPending}
                        autoFocus
                        className="text-xs h-8"
                      />
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="submit"
                          size="sm"
                          data-testid={`add-item-submit-${chk.id}`}
                          disabled={addItemMutation.isPending || !newItemContent.trim()}
                          className="h-7 text-xs px-2.5"
                        >
                          {addItemMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Add item"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAddingItemChecklistId(null);
                            setNewItemContent("");
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
                      data-testid={`add-item-trigger-${chk.id}`}
                      onClick={() => {
                        setAddingItemChecklistId(chk.id);
                        setNewItemContent("");
                      }}
                      className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" />
                      Add an item
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Checklist Form */}
      {isAddingChecklist && canEdit && (
        <form
          onSubmit={handleCreateChecklist}
          className="rounded-lg border bg-card p-3 shadow-sm space-y-2"
        >
          <div className="text-xs font-medium text-foreground">Add new checklist</div>
          <Input
            data-testid="new-checklist-title-input"
            placeholder="Checklist title (e.g. Acceptance Criteria)"
            value={newChecklistTitle}
            onChange={e => setNewChecklistTitle(e.target.value)}
            disabled={createChecklistMutation.isPending}
            autoFocus
            className="text-xs h-8"
          />
          <div className="flex items-center gap-1.5">
            <Button
              type="submit"
              size="sm"
              data-testid="new-checklist-submit-button"
              disabled={createChecklistMutation.isPending || !newChecklistTitle.trim()}
              className="h-7 text-xs px-2.5"
            >
              {createChecklistMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Create Checklist"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAddingChecklist(false);
                setNewChecklistTitle("");
              }}
              className="h-7 w-7 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
