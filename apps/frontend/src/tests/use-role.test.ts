import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useRole, type UseRoleReturn } from "../hooks/useRole";
import { useOrgStore } from "../store/useOrgStore";
import type { UserOrgMembership } from "../lib/org-api";

describe("useRole permissions hook", () => {
  // Ensure useSyncExternalStore resolves current store state during renderToStaticMarkup
  const originalUseSyncExternalStore = React.useSyncExternalStore;

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();
    useOrgStore.getState().resetOrgState();
  });

  afterAll(() => {
    (React as unknown as { useSyncExternalStore: unknown }).useSyncExternalStore = originalUseSyncExternalStore;
  });

  function renderUseRole(targetOrgId?: string): UseRoleReturn {
    let hookResult: UseRoleReturn | undefined;

    function TestHarness() {
      hookResult = useRole(targetOrgId);
      return null;
    }

    renderToStaticMarkup(React.createElement(TestHarness));

    if (!hookResult) {
      throw new Error("Failed to evaluate useRole hook within test harness");
    }

    return hookResult;
  }

  const sampleMemberships: UserOrgMembership[] = [
    {
      id: "mem-admin",
      role: "admin",
      accepted: true,
      userId: "user-1",
      orgId: "org-admin",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-01T00:00:00Z",
      org: { id: "org-admin", name: "Admin Org", description: "", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-emp",
      role: "employee",
      accepted: true,
      userId: "user-1",
      orgId: "org-emp",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-01T00:00:00Z",
      org: { id: "org-emp", name: "Employee Org", description: "", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-contrib",
      role: "contributor",
      accepted: true,
      userId: "user-1",
      orgId: "org-contrib",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-01T00:00:00Z",
      org: { id: "org-contrib", name: "Contributor Org", description: "", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-pending",
      role: "admin",
      accepted: false,
      userId: "user-1",
      orgId: "org-pending-admin",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: null,
      org: { id: "org-pending-admin", name: "Pending Invite", description: "", visible: true, createdAt: "", updatedAt: "" }
    }
  ];

  it("evaluates admin role with complete administrative capabilities", () => {
    useOrgStore.setState({
      activeOrgId: "org-admin",
      memberships: sampleMemberships
    });

    const perms = renderUseRole();

    expect(perms.role).toBe("admin");
    expect(perms.isAdmin).toBe(true);
    expect(perms.isEmployee).toBe(false);
    expect(perms.isContributor).toBe(false);

    // Administrative permissions
    expect(perms.canManageMembers).toBe(true);
    expect(perms.canInvite).toBe(true);
    expect(perms.canUpdateRole).toBe(true);
    expect(perms.canRemoveMember).toBe(true);
    expect(perms.canEditOrg).toBe(true);

    // Board permissions
    expect(perms.canCreateBoard).toBe(true);
  });

  it("evaluates employee role with board creation but restricted admin permissions", () => {
    useOrgStore.setState({
      activeOrgId: "org-emp",
      memberships: sampleMemberships
    });

    const perms = renderUseRole();

    expect(perms.role).toBe("employee");
    expect(perms.isAdmin).toBe(false);
    expect(perms.isEmployee).toBe(true);
    expect(perms.isContributor).toBe(false);

    // Administrative restrictions
    expect(perms.canManageMembers).toBe(false);
    expect(perms.canInvite).toBe(false);
    expect(perms.canUpdateRole).toBe(false);
    expect(perms.canRemoveMember).toBe(false);
    expect(perms.canEditOrg).toBe(false);

    // Board creation is allowed for employees
    expect(perms.canCreateBoard).toBe(true);
  });

  it("evaluates contributor role with read-only/board restrictions", () => {
    useOrgStore.setState({
      activeOrgId: "org-contrib",
      memberships: sampleMemberships
    });

    const perms = renderUseRole();

    expect(perms.role).toBe("contributor");
    expect(perms.isAdmin).toBe(false);
    expect(perms.isEmployee).toBe(false);
    expect(perms.isContributor).toBe(true);

    // No admin or board creation rights
    expect(perms.canManageMembers).toBe(false);
    expect(perms.canInvite).toBe(false);
    expect(perms.canUpdateRole).toBe(false);
    expect(perms.canRemoveMember).toBe(false);
    expect(perms.canEditOrg).toBe(false);
    expect(perms.canCreateBoard).toBe(false);
  });

  it("returns null role and false for all permissions when activeOrgId is null", () => {
    useOrgStore.setState({
      activeOrgId: null,
      memberships: sampleMemberships
    });

    const perms = renderUseRole();

    expect(perms.role).toBeNull();
    expect(perms.isAdmin).toBe(false);
    expect(perms.isEmployee).toBe(false);
    expect(perms.isContributor).toBe(false);
    expect(perms.canManageMembers).toBe(false);
    expect(perms.canInvite).toBe(false);
    expect(perms.canUpdateRole).toBe(false);
    expect(perms.canRemoveMember).toBe(false);
    expect(perms.canEditOrg).toBe(false);
    expect(perms.canCreateBoard).toBe(false);
  });

  it("returns null role and false for all permissions when memberships array is empty", () => {
    useOrgStore.setState({
      activeOrgId: "org-admin",
      memberships: []
    });

    const perms = renderUseRole();

    expect(perms.role).toBeNull();
    expect(perms.isAdmin).toBe(false);
    expect(perms.canCreateBoard).toBe(false);
  });

  it("treats unaccepted pending invitations as null role even if invited as admin", () => {
    // Security test: pending invite must not grant admin powers before acceptance
    useOrgStore.setState({
      activeOrgId: "org-pending-admin",
      memberships: sampleMemberships
    });

    const perms = renderUseRole();

    expect(perms.role).toBeNull();
    expect(perms.isAdmin).toBe(false);
    expect(perms.canManageMembers).toBe(false);
    expect(perms.canInvite).toBe(false);
    expect(perms.canCreateBoard).toBe(false);
  });

  it("resolves explicit targetOrgId independently from activeOrgId", () => {
    useOrgStore.setState({
      activeOrgId: "org-contrib", // active is contributor
      memberships: sampleMemberships
    });

    // Default call uses activeOrgId -> contributor
    const defaultPerms = renderUseRole();
    expect(defaultPerms.role).toBe("contributor");
    expect(defaultPerms.isAdmin).toBe(false);

    // Explicit targetOrgId overrides activeOrgId -> admin
    const adminPerms = renderUseRole("org-admin");
    expect(adminPerms.role).toBe("admin");
    expect(adminPerms.isAdmin).toBe(true);
    expect(adminPerms.canManageMembers).toBe(true);

    // Explicit targetOrgId for employee org -> employee
    const empPerms = renderUseRole("org-emp");
    expect(empPerms.role).toBe("employee");
    expect(empPerms.isEmployee).toBe(true);
    expect(empPerms.canCreateBoard).toBe(true);
    expect(empPerms.canManageMembers).toBe(false);

    // Explicit targetOrgId for unknown org -> null
    const unknownPerms = renderUseRole("org-non-existent");
    expect(unknownPerms.role).toBeNull();
    expect(unknownPerms.isAdmin).toBe(false);
    expect(unknownPerms.canCreateBoard).toBe(false);
  });
});
