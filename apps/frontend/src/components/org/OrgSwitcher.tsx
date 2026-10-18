import React, { useState, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useOrgStore } from "../../store/useOrgStore";
import { useRole } from "../../hooks/useRole";
import { CreateOrgModal } from "./CreateOrgModal";
import { PendingInvitesModal } from "./PendingInvitesModal";
import { MemberManagementModal } from "./MemberManagementModal";
import {
  Building2,
  ChevronDown,
  Check,
  Plus,
  Users,
  Mail
} from "lucide-react";

export interface OrgSwitcherProps {
  className?: string;
}

export function OrgSwitcher({ className }: OrgSwitcherProps) {
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const memberships = useOrgStore(s => s.memberships);
  const setActiveOrgId = useOrgStore(s => s.setActiveOrgId);

  const activeOrg = useMemo(() => {
    if (!activeOrgId) return null;
    return memberships.find(m => m.orgId === activeOrgId && m.accepted)?.org || null;
  }, [memberships, activeOrgId]);

  const acceptedOrgs = useMemo(() => {
    return memberships.filter(m => m.accepted).map(m => m.org);
  }, [memberships]);

  const pendingInvites = useMemo(() => {
    return memberships.filter(m => !m.accepted);
  }, [memberships]);

  const { isAdmin } = useRole(activeOrgId || undefined);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [invitesModalOpen, setInvitesModalOpen] = useState(false);
  const [membersModalOpen, setMembersModalOpen] = useState(false);

  const pendingCount = pendingInvites.length;

  return (
    <>
      <div className={`flex items-center gap-1.5 ${className || ""}`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 px-2.5 text-xs font-medium border-border/80 hover:bg-secondary/60 max-w-[200px] sm:max-w-[240px]"
            >
              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                <Building2 className="h-3 w-3" />
              </div>
              <span className="truncate">
                {activeOrg ? activeOrg.name : "Select Organization"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-56 p-1">
            <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Organizations
            </DropdownMenuLabel>

            <DropdownMenuGroup>
              {acceptedOrgs.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground italic">
                  No active organizations
                </div>
              ) : (
                acceptedOrgs.map(org => {
                  const isSelected = org.id === activeOrgId;
                  return (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => setActiveOrgId(org.id)}
                      className="flex items-center justify-between gap-2 text-xs py-1.5 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <span className="truncate font-medium">{org.name}</span>
                      </div>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Pending Invites trigger in dropdown */}
            {pendingCount > 0 && (
              <>
                <DropdownMenuItem
                  onClick={() => setInvitesModalOpen(true)}
                  className="flex items-center justify-between gap-2 text-xs py-1.5 cursor-pointer text-amber-600 dark:text-amber-400 font-medium"
                >
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5" />
                    <span>Invitations</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-bold border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    {pendingCount}
                  </Badge>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            {/* Admin Member Management trigger */}
            {isAdmin && activeOrg && (
              <DropdownMenuItem
                onClick={() => setMembersModalOpen(true)}
                className="flex items-center gap-2 text-xs py-1.5 cursor-pointer"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Manage Members</span>
              </DropdownMenuItem>
            )}

            {/* Create Organization trigger */}
            <DropdownMenuItem
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-2 text-xs py-1.5 cursor-pointer text-primary font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Organization</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Dedicated Pending Invites Header Badge Button */}
        {pendingCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInvitesModalOpen(true)}
            className="h-8 gap-1.5 px-2 text-xs font-semibold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 shadow-none animate-pulse"
            title={`${pendingCount} pending invitation${pendingCount > 1 ? "s" : ""}`}
          >
            <Mail className="h-3.5 w-3.5" />
            <span>{pendingCount}</span>
          </Button>
        )}
      </div>

      {/* Modals */}
      <CreateOrgModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
      />
      <PendingInvitesModal
        open={invitesModalOpen}
        onOpenChange={setInvitesModalOpen}
      />
      {activeOrgId && (
        <MemberManagementModal
          open={membersModalOpen}
          onOpenChange={setMembersModalOpen}
          orgId={activeOrgId}
        />
      )}
    </>
  );
}
