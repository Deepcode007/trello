import React, { useState } from "react";
import { MessageSquare, CornerDownRight, Edit2, Trash2, X, Loader2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { Avatar } from "../../ui/avatar";
import { useAuthStore } from "../../../store/useAuthStore";
import { useRole } from "../../../hooks/useRole";
import {
  useCommentsQuery,
  useCreateCommentMutation,
  useUpdateCommentMutation,
  useDeleteCommentMutation
} from "../../../hooks/useKanbanQueries";
import { getKanbanErrorMessage, type CommentNode } from "../../../lib/kanban-api";

export interface CardCommentsSectionProps {
  issueId: string;
  orgId?: string;
}

export function formatCommentDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return isoString;
  }
}

interface SingleCommentItemProps {
  comment: CommentNode;
  issueId: string;
  currentUserId?: string | null;
  currentUsername?: string | null;
  isAdmin: boolean;
  onReplySubmit: (parentId: string, description: string) => Promise<void>;
  onEditSubmit: (commentId: string, description: string) => Promise<void>;
  onDeleteSubmit: (commentId: string) => Promise<void>;
}

function SingleCommentItem({
  comment,
  issueId,
  currentUserId,
  currentUsername,
  isAdmin,
  onReplySubmit,
  onEditSubmit,
  onDeleteSubmit
}: SingleCommentItemProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.description);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 24-hour edit/delete eligibility check
  const commentAgeMs = Date.now() - new Date(comment.createdAt).getTime();
  const isWithin24h = commentAgeMs < 24 * 60 * 60 * 1000;

  const isAuthor = Boolean(
    (currentUserId && comment.user?.id && currentUserId === comment.user.id) ||
    (currentUsername && comment.user?.username && currentUsername === comment.user.username)
  );

  const canEdit = isAuthor && isWithin24h;
  const canDelete = (isAuthor && isWithin24h) || isAdmin;

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setIsSubmitting(true);
    try {
      await onReplySubmit(comment.id, replyText.trim());
      setReplyText("");
      setIsReplying(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editText.trim()) return;
    setIsSubmitting(true);
    try {
      await onEditSubmit(comment.id, editText.trim());
      setIsEditing(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid={`comment-${comment.id}`} className="space-y-2 text-xs">
      <div className="flex items-start gap-2.5">
        <Avatar
          size="sm"
          name={comment.user?.username || "User"}
          className="mt-0.5 shrink-0"
        />

        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {comment.user?.username || "Unknown"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatCommentDate(comment.createdAt)}
            </span>
          </div>

          {isEditing ? (
            <form onSubmit={handleEdit} className="space-y-2 pt-1">
              <Textarea
                data-testid={`edit-comment-input-${comment.id}`}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                disabled={isSubmitting}
                className="text-xs min-h-[60px]"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  type="submit"
                  size="sm"
                  data-testid={`save-comment-${comment.id}`}
                  disabled={isSubmitting || !editText.trim()}
                  className="h-6 text-xs px-2"
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    setEditText(comment.description);
                  }}
                  className="h-6 text-xs px-2"
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-foreground leading-relaxed whitespace-pre-wrap">
              {comment.description}
            </div>
          )}

          {/* Action links */}
          <div className="flex items-center gap-3 pt-0.5 text-[11px] text-muted-foreground">
            <button
              type="button"
              data-testid={`reply-comment-${comment.id}`}
              onClick={() => setIsReplying(!isReplying)}
              className="hover:text-foreground font-medium flex items-center gap-1"
            >
              <CornerDownRight className="h-3 w-3" />
              Reply
            </button>

            {canEdit && !isEditing && (
              <button
                type="button"
                data-testid={`edit-comment-${comment.id}`}
                onClick={() => {
                  setIsEditing(true);
                  setEditText(comment.description);
                }}
                className="hover:text-foreground font-medium flex items-center gap-1"
              >
                <Edit2 className="h-3 w-3" />
                Edit
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                data-testid={`delete-comment-${comment.id}`}
                onClick={() => onDeleteSubmit(comment.id)}
                className="hover:text-destructive font-medium flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </div>

          {/* Inline Reply Form */}
          {isReplying && (
            <form onSubmit={handleReply} className="space-y-2 pt-2">
              <Textarea
                data-testid={`reply-input-${comment.id}`}
                placeholder="Write a reply..."
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                disabled={isSubmitting}
                className="text-xs min-h-[50px]"
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <Button
                  type="submit"
                  size="sm"
                  data-testid={`submit-reply-${comment.id}`}
                  disabled={isSubmitting || !replyText.trim()}
                  className="h-6 text-xs px-2"
                >
                  Reply
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsReplying(false);
                    setReplyText("");
                  }}
                  className="h-6 text-xs px-2"
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Recursive Nested Replies */}
      {comment.children && comment.children.length > 0 && (
        <div className="ml-6 pl-3 border-l border-border/50 space-y-3 pt-2">
          {comment.children.map(child => (
            <SingleCommentItem
              key={child.id}
              comment={child}
              issueId={issueId}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              isAdmin={isAdmin}
              onReplySubmit={onReplySubmit}
              onEditSubmit={onEditSubmit}
              onDeleteSubmit={onDeleteSubmit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CardCommentsSection({ issueId, orgId }: CardCommentsSectionProps) {
  const currentUser = useAuthStore(s => s.user);
  const { isAdmin } = useRole(orgId);

  const { data: comments = [] } = useCommentsQuery(issueId);
  const createCommentMutation = useCreateCommentMutation(issueId);
  const updateCommentMutation = useUpdateCommentMutation(issueId);
  const deleteCommentMutation = useDeleteCommentMutation(issueId);

  const [newCommentText, setNewCommentText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handlePostRootComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCommentText.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await createCommentMutation.mutateAsync({ description: trimmed });
      setNewCommentText("");
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to post comment"));
    }
  };

  const handleReplySubmit = async (parentId: string, description: string) => {
    setError(null);
    try {
      await createCommentMutation.mutateAsync({
        description,
        parentId
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to post reply"));
    }
  };

  const handleEditSubmit = async (commentId: string, description: string) => {
    setError(null);
    try {
      await updateCommentMutation.mutateAsync({
        commentId,
        payload: { description }
      });
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to edit comment"));
    }
  };

  const handleDeleteSubmit = async (commentId: string) => {
    setError(null);
    try {
      await deleteCommentMutation.mutateAsync(commentId);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to delete comment"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>Activity & Discussion</span>
      </div>

      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}

      {/* Root Comment Form */}
      <form onSubmit={handlePostRootComment} className="space-y-2">
        <Textarea
          data-testid="new-comment-input"
          placeholder="Write a comment..."
          value={newCommentText}
          onChange={e => setNewCommentText(e.target.value)}
          disabled={createCommentMutation.isPending}
          className="text-xs min-h-[70px]"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            data-testid="post-comment-button"
            disabled={createCommentMutation.isPending || !newCommentText.trim()}
            className="h-7 text-xs px-3"
          >
            {createCommentMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Post Comment"
            )}
          </Button>
        </div>
      </form>

      {/* Comment Tree List */}
      <div className="space-y-4 pt-2">
        {comments.length > 0 ? (
          comments.map(comment => (
            <SingleCommentItem
              key={comment.id}
              comment={comment}
              issueId={issueId}
              currentUserId={currentUser?.id}
              currentUsername={currentUser?.username}
              isAdmin={isAdmin}
              onReplySubmit={handleReplySubmit}
              onEditSubmit={handleEditSubmit}
              onDeleteSubmit={handleDeleteSubmit}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No comments yet. Start the discussion!
          </p>
        )}
      </div>
    </div>
  );
}
