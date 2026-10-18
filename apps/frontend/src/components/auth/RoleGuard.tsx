import React from "react";
import { useRole } from "../../hooks/useRole";
import type { OrgRole } from "../../lib/org-api";

export interface RoleGuardProps {
  requiredRole?: OrgRole | OrgRole[];
  fallback?: React.ReactNode;
  orgId?: string;
  children: React.ReactNode;
}

/**
 * RoleGuard conditionally renders children based on the user's role
 * in the active (or specified) organization. If the user does not possess
 * the required role, the fallback element is rendered instead.
 */
export function RoleGuard({
  requiredRole,
  fallback = null,
  orgId,
  children
}: RoleGuardProps): React.ReactElement | null {
  const { role } = useRole(orgId);

  // If user has no active membership role in this org
  if (!role) {
    return <>{fallback}</>;
  }

  // If a specific requiredRole or list of roles was requested
  if (requiredRole) {
    const isAllowed = Array.isArray(requiredRole)
      ? requiredRole.includes(role)
      : role === requiredRole;

    if (!isAllowed) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}
