import React, { useState } from "react";
import { Users, Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../ui/button";
import { Avatar } from "../../ui/avatar";
import { orgApi } from "../../../lib/org-api";
import {
  useAssignIssueMutation,
  useRemoveAssignmentMutation
} from "../../../hooks/useKanbanQueries";
import { getKanbanErrorMessage, type IssueMappingItem } from "../../../lib/kanban-api";

export interface CardAssigneesSectionProps {
  boardId: string;
  orgId: string;
  issueId: string;
  assignedMappings?: IssueMappingItem[];
  canEdit: boolean;
}

export function CardAssigneesSection({
  boardId,
  orgId,
  issueId,
  assignedMappings = [],
  canEdit
}: CardAssigneesSectionProps) {
  const { data: orgMembers = [] } = useQuery({
    queryKey: ["orgMembers", orgId],
    queryFn: () => orgApi.getOrgMembers(orgId),
    enabled: Boolean(orgId)
  });

  const assignMutation = useAssignIssueMutation(boardId, issueId);
  const removeMutation = useRemoveAssignmentMutation(boardId, issueId);

  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignedEmails = new Set(
    assignedMappings.map(m => m.user?.email).filter(Boolean)
  );

  const handleAssign = async (email: string) => {
    setError(null);
    try {
      await assignMutation.mutateAsync([email]);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to assign member"));
    }
  };

  const handleRemove = async (email: string) => {
    setError(null);
    try {
      await removeMutation.mutateAsync(email);
    } catch (err: unknown) {
      setError(getKanbanErrorMessage(err, "Failed to remove member"));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>Assignees</span>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="assign-member-trigger"
            onClick={() => setIsOpen(!isOpen)}
            className="h-6 text-xs px-2 gap-1 text-primary hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            {isOpen ? "Close" : "Assign"}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}

      {/* Assigned Members List */}
      <div className="flex flex-wrap items-center gap-2">
        {assignedMappings.length > 0 ? (
          assignedMappings.map(({ user }) => {
            if (!user) return null;
            return (
              <div
                key={user.id || user.email}
                className="flex items-center gap-1.5 rounded-full border bg-secondary/50 py-0.5 pl-1 pr-2 text-xs"
              >
                <Avatar
                  size="sm"
                  name={user.name || user.username}
                  email={user.email}
                  src={user.avatarUrl}
                />
                <span className="font-medium text-foreground truncate max-w-[120px]">
                  {user.name || user.username}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    data-testid={`remove-assignee-${user.email}`}
                    onClick={() => handleRemove(user.email)}
                    className="ml-0.5 text-muted-foreground hover:text-destructive rounded-full focus:outline-none"
                    title={`Unassign ${user.name || user.username}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <span className="text-xs text-muted-foreground italic">No members assigned</span>
        )}
      </div>

      {/* Member Picker Dropdown */}
      {isOpen && canEdit && (
        <div className="mt-2 rounded-lg border bg-card p-2 shadow-md space-y-1 max-h-48 overflow-y-auto">
          <div className="text-xs font-medium text-foreground px-2 py-1">
            Assign team member
          </div>
          {orgMembers
            .filter(m => m.accepted)
            .map(member => {
              const isAssigned = assignedEmails.has(member.user.email);
              return (
                <button
                  key={member.user.email}
                  type="button"
                  data-testid={`assign-member-${member.user.email}`}
                  onClick={() =>
                    isAssigned
                      ? handleRemove(member.user.email)
                      : handleAssign(member.user.email)
                  }
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left hover:bg-secondary/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Avatar
                      size="sm"
                      name={member.user.username}
                      email={member.user.email}
                    />
                    <div>
                      <div className="font-medium text-foreground">
                        {member.user.username}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {member.user.email}
                      </div>
                    </div>
                  </div>
                  {isAssigned && (
                    <span className="text-[10px] font-semibold text-primary">
                      Assigned
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
