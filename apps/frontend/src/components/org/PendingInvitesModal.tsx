import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useOrgStore } from "../../store/useOrgStore";
import { Mail, Building2, Check, Loader2, AlertCircle } from "lucide-react";

export interface PendingInvitesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PendingInvitesModal({
  open,
  onOpenChange
}: PendingInvitesModalProps) {
  const memberships = useOrgStore(s => s.memberships);
  const acceptInvite = useOrgStore(s => s.acceptInvite);
  const pendingInvites = useMemo(() => memberships.filter(m => !m.accepted), [memberships]);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async (orgId: string) => {
    setError(null);
    setAcceptingId(orgId);

    try {
      const result = await acceptInvite(orgId);
      if (!result.success) {
        setError(result.error || "Failed to accept invitation");
      } else {
        // If this was the last pending invite, we can automatically close the modal
        if (pendingInvites.length <= 1) {
          onOpenChange(false);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Pending Invitations</DialogTitle>
              <DialogDescription className="mt-0.5">
                Review and accept invitations to join organizations.
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

        <div className="space-y-3 pt-1">
          {pendingInvites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Mail className="h-10 w-10 text-muted-foreground/40 stroke-1 mb-2" />
              <p className="text-sm font-medium">No pending invitations</p>
              <p className="text-xs text-muted-foreground/80 mt-1">
                You&apos;re all caught up! New invites from organization admins will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {pendingInvites.map(invite => {
                const isAccepting = acceptingId === invite.orgId;

                return (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors hover:border-primary/30"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-sm text-foreground truncate">
                            {invite.org?.name || "Organization"}
                          </h4>
                          <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0">
                            {invite.role}
                          </Badge>
                        </div>
                        {invite.org?.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {invite.org.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleAccept(invite.orgId)}
                      disabled={isAccepting || acceptingId !== null}
                      className="shrink-0 gap-1.5 h-8 text-xs font-medium"
                    >
                      {isAccepting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Accepting...
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Accept
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
