import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { useOrgStore } from "../../store/useOrgStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useRole } from "../../hooks/useRole";
import {
  orgApi,
  getOrgErrorMessage,
  type OrgMemberItem,
  type OrgRole
} from "../../lib/org-api";
import {
  Users,
  UserPlus,
  Trash2,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock
} from "lucide-react";

export interface MemberManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId?: string;
}

export function MemberManagementModal({
  open,
  onOpenChange,
  orgId
}: MemberManagementModalProps) {
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const memberships = useOrgStore(s => s.memberships);
  const loadOrgs = useOrgStore(s => s.loadOrgs);
  const currentUser = useAuthStore(s => s.user);

  const targetOrgId = orgId || activeOrgId;
  const activeOrg = useMemo(() => {
    if (!targetOrgId) return null;
    return memberships.find(m => m.orgId === targetOrgId && m.accepted)?.org || null;
  }, [memberships, targetOrgId]);
  const { isAdmin, canInvite, canUpdateRole, canRemoveMember } = useRole(targetOrgId || undefined);

  const [members, setMembers] = useState<OrgMemberItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Action status (per-member role update or removal)
  const [actionEmail, setActionEmail] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!targetOrgId) return;
    setIsLoading(true);
    setFetchError(null);

    try {
      const data = await orgApi.getOrgMembers(targetOrgId);
      setMembers(data);
    } catch (err: unknown) {
      setFetchError(getOrgErrorMessage(err, "Failed to load organization members"));
    } finally {
      setIsLoading(false);
    }
  }, [targetOrgId]);

  // Load members when opened
  useEffect(() => {
    if (open && targetOrgId) {
      fetchMembers();
      setInviteEmail("");
      setInviteError(null);
      setInviteSuccess(null);
      setActionError(null);
      setActionEmail(null);
    }
  }, [open, targetOrgId, fetchMembers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetOrgId) return;

    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      setInviteError("Please enter an email address.");
      return;
    }

    setInviteError(null);
    setInviteSuccess(null);
    setIsInviting(true);

    try {
      await orgApi.inviteMember(targetOrgId, trimmedEmail);
      setInviteSuccess(`Invitation sent to ${trimmedEmail}!`);
      setInviteEmail("");
      // Refresh member list to show newly invited member
      await fetchMembers();
    } catch (err: unknown) {
      const msg = getOrgErrorMessage(err, "Failed to send invitation");
      if (msg === "User not signed up") {
        setInviteError("User not found. They must register an account first before they can be invited.");
      } else if (msg === "User already member") {
        setInviteError("This user is already an active member of this organization.");
      } else if (msg === "User already invited") {
        setInviteError("An invitation has already been sent to this email address.");
      } else {
        setInviteError(msg);
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleChange = async (memberEmail: string, newRole: OrgRole, currentRole: OrgRole) => {
    if (!targetOrgId || newRole === currentRole) return;

    // Check last admin demotion client-side safeguard
    const adminCount = members.filter(m => m.role === "admin" && m.accepted).length;
    if (currentRole === "admin" && newRole !== "admin" && adminCount <= 1) {
      setActionError("Cannot demote the last remaining admin.");
      return;
    }

    setActionError(null);
    setActionEmail(memberEmail);

    try {
      await orgApi.updateMemberRole(targetOrgId, memberEmail, newRole);
      await fetchMembers();
    } catch (err: unknown) {
      setActionError(getOrgErrorMessage(err, "Failed to update member role"));
    } finally {
      setActionEmail(null);
    }
  };

  const handleRemoveMember = async (memberEmail: string, isSelf: boolean) => {
    if (!targetOrgId) return;

    const targetMember = members.find(m => m.user.email === memberEmail);
    const adminCount = members.filter(m => m.role === "admin" && m.accepted).length;

    if (targetMember?.role === "admin" && adminCount <= 1) {
      setActionError("Cannot remove the last remaining admin from the organization.");
      return;
    }

    setActionError(null);
    setActionEmail(memberEmail);

    try {
      await orgApi.removeMember(targetOrgId, memberEmail);

      if (isSelf) {
        // User voluntarily left the organization
        await loadOrgs();
        onOpenChange(false);
      } else {
        // Another member was removed
        await fetchMembers();
      }
    } catch (err: unknown) {
      setActionError(getOrgErrorMessage(err, "Failed to remove member"));
    } finally {
      setActionEmail(null);
    }
  };

  const activeAdminCount = members.filter(m => m.role === "admin" && m.accepted).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Member Management</DialogTitle>
              <DialogDescription className="mt-0.5">
                Manage team members, roles, and invitations for {activeOrg?.name || "this organization"}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Action Error Banner */}
        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive shrink-0 mt-2"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{actionError}</span>
          </div>
        )}

        {/* Invite Form (Admins Only) */}
        {canInvite && (
          <div className="rounded-lg border bg-secondary/30 p-3.5 space-y-2 shrink-0 mt-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <UserPlus className="h-3.5 w-3.5" />
              Invite New Member
            </div>

            {inviteError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{inviteError}</span>
              </div>
            )}

            {inviteSuccess && (
              <div
                role="status"
                className="flex items-start gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{inviteSuccess}</span>
              </div>
            )}

            <form onSubmit={handleInvite} className="flex gap-2">
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                disabled={isInviting}
                className="h-8 text-xs flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={isInviting || !inviteEmail.trim()}
                className="h-8 gap-1.5 text-xs font-medium shrink-0"
              >
                {isInviting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Inviting...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" />
                    Send Invite
                  </>
                )}
              </Button>
            </form>
          </div>
        )}

        {/* Members List */}
        <div className="flex-1 overflow-y-auto space-y-2 py-3 min-h-[200px]">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1">
            <span>Members & Invites ({members.length})</span>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>

          {fetchError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-xs text-destructive">
              <AlertCircle className="h-6 w-6 mx-auto mb-1.5 opacity-80" />
              <p className="font-semibold">Failed to load members</p>
              <p className="mt-0.5">{fetchError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchMembers}
                className="mt-3 h-7 text-xs"
              >
                Try Again
              </Button>
            </div>
          ) : isLoading && members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin mb-2 text-primary" />
              <p className="text-xs">Loading members...</p>
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No members found for this organization.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(member => {
                const isCurrent = currentUser?.email?.toLowerCase() === member.user.email.toLowerCase();
                const isPerformingAction = actionEmail === member.user.email;
                const isLastAdmin = member.role === "admin" && activeAdminCount <= 1;

                return (
                  <div
                    key={member.user.email}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2.5 transition-colors hover:bg-secondary/20"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Avatar
                        name={member.user.username}
                        email={member.user.email}
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-foreground truncate">
                            {member.user.username}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-primary/10 px-1 py-0.2 text-[10px] font-bold text-primary">
                              You
                            </span>
                          )}
                          {!member.accepted && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              <Clock className="h-2.5 w-2.5" />
                              Pending Invite
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {member.user.email}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role Selector or Badge */}
                      {canUpdateRole && member.accepted ? (
                        <select
                          value={member.role}
                          onChange={e =>
                            handleRoleChange(member.user.email, e.target.value as OrgRole, member.role)
                          }
                          disabled={isPerformingAction || (isLastAdmin && member.role === "admin")}
                          title={isLastAdmin ? "Cannot demote the last remaining admin" : "Change role"}
                          className="h-7 rounded border border-input bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 cursor-pointer"
                        >
                          <option value="admin">Admin</option>
                          <option value="employee">Employee</option>
                          <option value="contributor">Contributor</option>
                        </select>
                      ) : (
                        <Badge
                          variant={
                            member.role === "admin"
                              ? "default"
                              : member.role === "employee"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5"
                        >
                          {member.role}
                        </Badge>
                      )}

                      {/* Remove / Leave Action Button */}
                      {(canRemoveMember || isCurrent) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveMember(member.user.email, isCurrent)}
                          disabled={isPerformingAction || (isCurrent && isLastAdmin)}
                          title={
                            isCurrent && isLastAdmin
                              ? "Cannot leave as the last remaining admin"
                              : isCurrent
                              ? "Leave organization"
                              : "Remove member"
                          }
                          className={`h-7 px-2 text-xs gap-1 ${
                            isCurrent
                              ? "text-muted-foreground hover:text-destructive"
                              : "text-destructive hover:bg-destructive/10"
                          }`}
                        >
                          {isPerformingAction ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : isCurrent ? (
                            <>
                              <LogOut className="h-3 w-3" />
                              Leave
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-3 w-3" />
                              Remove
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t shrink-0">
          <div className="text-[11px] text-muted-foreground">
            {isAdmin ? "You are an admin of this organization" : "Member access"}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
