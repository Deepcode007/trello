import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { CardLabelsSection } from "./CardLabelsSection";
import { CardAssigneesSection } from "./CardAssigneesSection";
import { CardChecklistsSection } from "./CardChecklistsSection";
import { CardCommentsSection } from "./CardCommentsSection";
import { useRole } from "../../../hooks/useRole";
import {
  useIssueDetailQuery,
  useUpdateIssueMutation,
  useMoveIssueMutation,
  useDeleteIssueMutation
} from "../../../hooks/useKanbanQueries";
import { getKanbanErrorMessage, type Priority } from "../../../lib/kanban-api";
import type { BoardSection } from "../../../lib/board-api";
import {
  CreditCard,
  Trash2,
  Calendar,
  ExternalLink,
  Loader2,
  Check
} from "lucide-react";

export interface CardDetailModalProps {
  issueId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  orgId: string;
  allSections: BoardSection[];
}

export function CardDetailModal({
  issueId,
  open,
  onOpenChange,
  boardId,
  orgId,
  allSections
}: CardDetailModalProps) {
  const { canEditBoard } = useRole(orgId);

  const {
    data: issue,
    isLoading,
    isError,
    error: queryError
  } = useIssueDetailQuery(issueId);

  const updateIssueMutation = useUpdateIssueMutation(boardId, issueId);
  const moveIssueMutation = useMoveIssueMutation(boardId);
  const deleteIssueMutation = useDeleteIssueMutation(boardId);

  // Local state for editable fields (initialized with issue for SSR compatibility)
  const [title, setTitle] = useState(issue?.title || "");
  const [description, setDescription] = useState(issue?.description || "");
  const [priority, setPriority] = useState<Priority>(issue?.priority || "medium");
  const [startDate, setStartDate] = useState(
    issue?.startDate ? issue.startDate.split("T")[0] || "" : ""
  );
  const [dueDate, setDueDate] = useState(
    issue?.dueDate ? issue.dueDate.split("T")[0] || "" : ""
  );
  const [ghUrl, setGhUrl] = useState(issue?.gh_url || "");
  const [descSaved, setDescSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (issue) {
      setTitle(issue.title || "");
      setDescription(issue.description || "");
      setPriority(issue.priority || "medium");
      setStartDate(issue.startDate ? issue.startDate.split("T")[0] || "" : "");
      setDueDate(issue.dueDate ? issue.dueDate.split("T")[0] || "" : "");
      setGhUrl(issue.gh_url || "");
      setError(null);
      setDescSaved(false);
    }
  }, [issue]);

  const handleTitleBlur = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === issue?.title || !issueId) return;

    try {
      await updateIssueMutation.mutateAsync({
        issueId,
        updates: { title: trimmed }
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update title"));
    }
  };

  const handleSaveDescription = async () => {
    if (!issueId) return;
    setError(null);
    try {
      await updateIssueMutation.mutateAsync({
        issueId,
        updates: { description: description.trim() }
      });
      setDescSaved(true);
      setTimeout(() => setDescSaved(false), 2000);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update description"));
    }
  };

  const handlePriorityChange = async (newPriority: Priority) => {
    setPriority(newPriority);
    if (!issueId) return;
    try {
      await updateIssueMutation.mutateAsync({
        issueId,
        updates: { priority: newPriority }
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update priority"));
    }
  };

  const handleMoveColumn = async (newSectionId: string) => {
    if (!issueId || newSectionId === issue?.sectionId) return;
    try {
      await moveIssueMutation.mutateAsync({
        issueId,
        sectionId: newSectionId
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to move card"));
    }
  };

  const handleDatesChange = async (newStart: string, newDue: string) => {
    setStartDate(newStart);
    setDueDate(newDue);
    if (!issueId) return;
    try {
      await updateIssueMutation.mutateAsync({
        issueId,
        updates: {
          startDate: newStart ? new Date(newStart).toISOString() : null,
          dueDate: newDue ? new Date(newDue).toISOString() : null
        }
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update dates"));
    }
  };

  const handleClearDates = async () => {
    await handleDatesChange("", "");
  };

  const handleGhUrlBlur = async () => {
    const trimmed = ghUrl.trim();
    if (trimmed === (issue?.gh_url || "") || !issueId) return;
    try {
      await updateIssueMutation.mutateAsync({
        issueId,
        updates: { gh_url: trimmed || undefined }
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to update GitHub URL"));
    }
  };

  const handleDeleteCard = async () => {
    if (!issueId) return;
    if (!window.confirm("Are you sure you want to delete this card?")) return;
    try {
      await deleteIssueMutation.mutateAsync(issueId);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to delete card"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto"
        data-testid="card-detail-modal"
      >
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary shrink-0" />
            <DialogTitle className="sr-only">Card Details</DialogTitle>
            <DialogDescription className="sr-only">
              View and edit card details, checklists, labels, and comments.
            </DialogDescription>
            <Input
              data-testid="card-detail-title-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              disabled={!canEditBoard || updateIssueMutation.isPending}
              className="text-base font-semibold border-transparent hover:border-input focus:border-input px-2 h-9"
              placeholder="Card title..."
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground px-2">
            <span>in column</span>
            <select
              data-testid="move-column-select"
              value={issue?.sectionId || allSections[0]?.id || ""}
              onChange={e => handleMoveColumn(e.target.value)}
              disabled={!canEditBoard || moveIssueMutation.isPending}
              className="rounded border border-input bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {allSections.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        </DialogHeader>

        {error && (
          <p className="text-xs text-destructive px-2">{error}</p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive p-4">
            {getKanbanErrorMessage(queryError, "Failed to load card details")}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            {/* Main Content Area (2 Cols) */}
            <div className="md:col-span-2 space-y-6">
              {/* Description Section */}
              <div className="space-y-2">
                <Label htmlFor="card-description" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </Label>
                <Textarea
                  id="card-description"
                  data-testid="card-detail-description-input"
                  placeholder="Add a more detailed description..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={!canEditBoard}
                  className="min-h-[100px] text-xs leading-relaxed"
                />
                {canEditBoard && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      data-testid="save-description-button"
                      onClick={handleSaveDescription}
                      disabled={updateIssueMutation.isPending}
                      className="h-7 text-xs px-2.5 gap-1"
                    >
                      {descSaved ? (
                        <>
                          <Check className="h-3 w-3 text-white" />
                          Saved
                        </>
                      ) : (
                        "Save description"
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Checklists Section */}
              {issueId && (
                <CardChecklistsSection
                  boardId={boardId}
                  issueId={issueId}
                  checklists={issue?.checklists}
                  canEdit={canEditBoard}
                />
              )}

              {/* Comments Section */}
              {issueId && (
                <CardCommentsSection
                  issueId={issueId}
                  orgId={orgId}
                />
              )}
            </div>

            {/* Sidebar Properties Area (1 Col) */}
            <div className="space-y-5 border-t md:border-t-0 md:border-l border-border/40 md:pl-5">
              {/* Priority Selector */}
              <div className="space-y-1.5">
                <Label htmlFor="priority-select" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Priority
                </Label>
                <select
                  id="priority-select"
                  data-testid="priority-select"
                  value={priority}
                  onChange={e => handlePriorityChange(e.target.value as Priority)}
                  disabled={!canEditBoard}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Dates Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Dates</span>
                  </div>
                  {canEditBoard && (startDate || dueDate) && (
                    <button
                      type="button"
                      data-testid="clear-dates-button"
                      onClick={handleClearDates}
                      className="text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="start-date-input" className="text-[11px] text-muted-foreground">Start date</label>
                  <Input
                    id="start-date-input"
                    data-testid="start-date-input"
                    type="date"
                    value={startDate}
                    onChange={e => handleDatesChange(e.target.value, dueDate)}
                    disabled={!canEditBoard}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="due-date-input" className="text-[11px] text-muted-foreground">Due date</label>
                  <Input
                    id="due-date-input"
                    data-testid="due-date-input"
                    type="date"
                    value={dueDate}
                    onChange={e => handleDatesChange(startDate, e.target.value)}
                    disabled={!canEditBoard}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* GitHub Issue URL */}
              <div className="space-y-1.5">
                <Label htmlFor="gh-url-input" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  GitHub Link
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="gh-url-input"
                    data-testid="gh-url-input"
                    placeholder="https://github.com/..."
                    value={ghUrl}
                    onChange={e => setGhUrl(e.target.value)}
                    onBlur={handleGhUrlBlur}
                    disabled={!canEditBoard}
                    className="h-8 text-xs"
                  />
                  {ghUrl && (
                    <a
                      href={ghUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0"
                      title="Open GitHub Issue"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Labels Section */}
              {issueId && (
                <CardLabelsSection
                  boardId={boardId}
                  issueId={issueId}
                  attachedLabels={issue?.labels}
                  canEdit={canEditBoard}
                />
              )}

              {/* Assignees Section */}
              {issueId && (
                <CardAssigneesSection
                  boardId={boardId}
                  orgId={orgId}
                  issueId={issueId}
                  assignedMappings={issue?.issueMappings}
                  canEdit={canEditBoard}
                />
              )}

              {/* Actions / Delete */}
              {canEditBoard && (
                <div className="pt-4 border-t border-border/40">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="delete-card-button"
                    onClick={handleDeleteCard}
                    disabled={deleteIssueMutation.isPending}
                    className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive h-8 text-xs gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Card
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
