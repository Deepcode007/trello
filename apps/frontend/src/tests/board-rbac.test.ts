import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useRole, type UseRoleReturn } from "../hooks/useRole";
import { useOrgStore } from "../store/useOrgStore";
import type { UserOrgMembership } from "../lib/org-api";

describe("Board Role-Based Access Control (RBAC) via useRole", () => {
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
      throw new Error("Failed to evaluate useRole within test harness");
    }

    return hookResult;
  }

  const createMembership = (orgId: string, role: "admin" | "employee" | "contributor", accepted = true): UserOrgMembership => ({
    id: `mem-${orgId}-${role}`,
    role,
    accepted,
    userId: "u-test",
    orgId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: accepted ? "2026-01-01T00:00:00Z" : null,
    org: {
      id: orgId,
      name: `Org ${orgId}`,
      description: "Description",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  });

  it("grants full board privileges to organization admin", () => {
    useOrgStore.setState({
      memberships: [createMembership("org-admin", "admin")],
      activeOrgId: "org-admin"
    });

    const perms = renderUseRole();
    expect(perms.isAdmin).toBe(true);
    expect(perms.canCreateBoard).toBe(true);
    expect(perms.canEditBoard).toBe(true);
    expect(perms.canArchiveBoard).toBe(true);
    expect(perms.canDeleteBoard).toBe(true);
  });

  it("grants board management privileges to organization employee", () => {
    useOrgStore.setState({
      memberships: [createMembership("org-emp", "employee")],
      activeOrgId: "org-emp"
    });

    const perms = renderUseRole();
    expect(perms.isEmployee).toBe(true);
    expect(perms.isAdmin).toBe(false);
    expect(perms.canCreateBoard).toBe(true);
    expect(perms.canEditBoard).toBe(true);
    expect(perms.canArchiveBoard).toBe(true);
    expect(perms.canDeleteBoard).toBe(true);
    expect(perms.canManageMembers).toBe(false);
  });

  it("restricts contributor to read-only access (all board mutations false)", () => {
    useOrgStore.setState({
      memberships: [createMembership("org-contrib", "contributor")],
      activeOrgId: "org-contrib"
    });

    const perms = renderUseRole();
    expect(perms.isContributor).toBe(true);
    expect(perms.isAdmin).toBe(false);
    expect(perms.isEmployee).toBe(false);
    expect(perms.canCreateBoard).toBe(false);
    expect(perms.canEditBoard).toBe(false);
    expect(perms.canArchiveBoard).toBe(false);
    expect(perms.canDeleteBoard).toBe(false);
  });

  it("denies all board operations when user has not accepted invitation", () => {
    useOrgStore.setState({
      memberships: [createMembership("org-pending", "admin", false)],
      activeOrgId: "org-pending"
    });

    const perms = renderUseRole();
    expect(perms.role).toBeNull();
    expect(perms.canCreateBoard).toBe(false);
    expect(perms.canEditBoard).toBe(false);
    expect(perms.canArchiveBoard).toBe(false);
    expect(perms.canDeleteBoard).toBe(false);
  });

  it("evaluates targetOrgId independently from activeOrgId", () => {
    useOrgStore.setState({
      memberships: [
        createMembership("org-1", "contributor"),
        createMembership("org-2", "employee")
      ],
      activeOrgId: "org-1"
    });

    // Default to activeOrgId (org-1: contributor)
    const activePerms = renderUseRole();
    expect(activePerms.canCreateBoard).toBe(false);

    // Target org-2 explicitly (org-2: employee)
    const targetPerms = renderUseRole("org-2");
    expect(targetPerms.canCreateBoard).toBe(true);
    expect(targetPerms.canEditBoard).toBe(true);
  });
});
