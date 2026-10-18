import { useMemo } from "react";
import { useOrgStore } from "../store/useOrgStore";
import type { OrgRole } from "../lib/org-api";

export interface UseRoleReturn {
  role: OrgRole | null;
  isAdmin: boolean;
  isEmployee: boolean;
  isContributor: boolean;
  canManageMembers: boolean;
  canInvite: boolean;
  canUpdateRole: boolean;
  canRemoveMember: boolean;
  canCreateBoard: boolean;
  canEditBoard: boolean;
  canArchiveBoard: boolean;
  canDeleteBoard: boolean;
  canEditOrg: boolean;
}

/**
 * Hook to access and evaluate the current user's role and permissions
 * in the active organization (or a specified target organization).
 */
export function useRole(targetOrgId?: string): UseRoleReturn {
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const memberships = useOrgStore(s => s.memberships);

  const orgId = targetOrgId || activeOrgId;
  const membership = orgId
    ? memberships.find(m => m.orgId === orgId && m.accepted)
    : null;

  const role = membership?.role ?? null;
  const isAdmin = role === "admin";
  const isEmployee = role === "employee";
  const isContributor = role === "contributor";
  const canModifyBoard = isAdmin || isEmployee;

  return useMemo(() => ({
    role,
    isAdmin,
    isEmployee,
    isContributor,
    canManageMembers: isAdmin,
    canInvite: isAdmin,
    canUpdateRole: isAdmin,
    canRemoveMember: isAdmin,
    canCreateBoard: canModifyBoard,
    canEditBoard: canModifyBoard,
    canArchiveBoard: canModifyBoard,
    canDeleteBoard: canModifyBoard,
    canEditOrg: isAdmin
  }), [role, isAdmin, isEmployee, isContributor, canModifyBoard]);
}
