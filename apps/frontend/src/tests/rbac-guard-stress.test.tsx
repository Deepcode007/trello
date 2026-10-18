import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock DialogPortal for server-side static rendering without DOM portal mounting
mock.module("../components/ui/dialog", () => ({
  ...RealDialogUI,
  DialogPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
}));

// Mock DropdownMenuContent and DropdownMenuItem for server-side static rendering
mock.module("../components/ui/dropdown-menu", () => ({
  ...RealDropdownUI,
  DropdownMenuContent: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { className, "data-slot": "dropdown-content" }, children),
  DropdownMenuItem: ({
    children,
    className,
    onClick
  }: {
    children?: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => React.createElement("div", { className, "data-slot": "dropdown-item", onClick }, children)
}));

import { useRole, type UseRoleReturn } from "../hooks/useRole";
import { RoleGuard } from "../components/auth/RoleGuard";
import { MemberManagementModal } from "../components/org/MemberManagementModal";
import { OrgSwitcher } from "../components/org/OrgSwitcher";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import type { OrgMemberItem, OrgRole, UserOrgMembership } from "../lib/org-api";

// Typed component helper allowing children to be passed as trailing createElement args
const Guard = RoleGuard as unknown as (props: {
  requiredRole?: OrgRole | OrgRole[];
  fallback?: React.ReactNode;
  orgId?: string;
  children?: React.ReactNode;
}) => React.ReactElement | null;

describe("Step 3 RBAC & UI Guard Adversarial Stress Suite", () => {
  const originalUseSyncExternalStore = React.useSyncExternalStore;
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      H: { useState: (init: unknown) => [unknown, (v: unknown) => void] };
    };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();
    useOrgStore.getState().resetOrgState();
    useAuthStore.setState({
      user: null,
      token: null,
      isLoading: false
    });
  });

  afterAll(() => {
    (React as unknown as { useSyncExternalStore: unknown }).useSyncExternalStore = originalUseSyncExternalStore;
  });

  function evaluateUseRole(targetOrgId?: string): UseRoleReturn {
    let result: UseRoleReturn | undefined;
    function Harness() {
      result = useRole(targetOrgId);
      return null;
    }
    renderToStaticMarkup(React.createElement(Harness));
    if (!result) {
      throw new Error("Failed to resolve useRole hook");
    }
    return result;
  }

  const sampleMemberships: UserOrgMembership[] = [
    {
      id: "mem-admin",
      role: "admin",
      accepted: true,
      userId: "u-1",
      orgId: "org-admin",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-01T00:00:00Z",
      org: { id: "org-admin", name: "Admin Org", description: "Admin Org Desc", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-employee",
      role: "employee",
      accepted: true,
      userId: "u-1",
      orgId: "org-employee",
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      acceptedAt: "2026-01-02T00:00:00Z",
      org: { id: "org-employee", name: "Employee Org", description: "Employee Org Desc", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-contributor",
      role: "contributor",
      accepted: true,
      userId: "u-1",
      orgId: "org-contributor",
      createdAt: "2026-01-03T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z",
      acceptedAt: "2026-01-03T00:00:00Z",
      org: { id: "org-contributor", name: "Contributor Org", description: "Contributor Org Desc", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-pending-admin",
      role: "admin",
      accepted: false,
      userId: "u-1",
      orgId: "org-pending-admin",
      createdAt: "2026-01-04T00:00:00Z",
      updatedAt: "2026-01-04T00:00:00Z",
      acceptedAt: null,
      org: { id: "org-pending-admin", name: "Pending Admin Org", description: "Pending Org Desc", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-pending-emp",
      role: "employee",
      accepted: false,
      userId: "u-1",
      orgId: "org-pending-emp",
      createdAt: "2026-01-05T00:00:00Z",
      updatedAt: "2026-01-05T00:00:00Z",
      acceptedAt: null,
      org: { id: "org-pending-emp", name: "Pending Emp Org", description: "Pending Org Desc", visible: true, createdAt: "", updatedAt: "" }
    },
    {
      id: "mem-pending-contrib",
      role: "contributor",
      accepted: false,
      userId: "u-1",
      orgId: "org-pending-contrib",
      createdAt: "2026-01-06T00:00:00Z",
      updatedAt: "2026-01-06T00:00:00Z",
      acceptedAt: null,
      org: { id: "org-pending-contrib", name: "Pending Contrib Org", description: "Pending Org Desc", visible: true, createdAt: "", updatedAt: "" }
    }
  ];

  /* -------------------------------------------------------------------------- */
  /* 1. RBAC Stress Testing                                                      */
  /* -------------------------------------------------------------------------- */
  describe("1. RBAC Capability Derivation & State Transitions", () => {
    it("evaluates admin role capabilities across all operational flags", () => {
      useOrgStore.setState({ activeOrgId: "org-admin", memberships: sampleMemberships });
      const caps = evaluateUseRole();

      expect(caps.role).toBe("admin");
      expect(caps.isAdmin).toBe(true);
      expect(caps.isEmployee).toBe(false);
      expect(caps.isContributor).toBe(false);
      expect(caps.canManageMembers).toBe(true);
      expect(caps.canInvite).toBe(true);
      expect(caps.canUpdateRole).toBe(true);
      expect(caps.canRemoveMember).toBe(true);
      expect(caps.canCreateBoard).toBe(true);
      expect(caps.canEditOrg).toBe(true);
    });

    it("evaluates employee role capabilities strictly locking out admin actions", () => {
      useOrgStore.setState({ activeOrgId: "org-employee", memberships: sampleMemberships });
      const caps = evaluateUseRole();

      expect(caps.role).toBe("employee");
      expect(caps.isAdmin).toBe(false);
      expect(caps.isEmployee).toBe(true);
      expect(caps.isContributor).toBe(false);
      // Admin operations must be locked
      expect(caps.canManageMembers).toBe(false);
      expect(caps.canInvite).toBe(false);
      expect(caps.canUpdateRole).toBe(false);
      expect(caps.canRemoveMember).toBe(false);
      expect(caps.canEditOrg).toBe(false);
      // Employee specific capability
      expect(caps.canCreateBoard).toBe(true);
    });

    it("evaluates contributor role capabilities locking out admin actions AND board creation", () => {
      useOrgStore.setState({ activeOrgId: "org-contributor", memberships: sampleMemberships });
      const caps = evaluateUseRole();

      expect(caps.role).toBe("contributor");
      expect(caps.isAdmin).toBe(false);
      expect(caps.isEmployee).toBe(false);
      expect(caps.isContributor).toBe(true);
      expect(caps.canManageMembers).toBe(false);
      expect(caps.canInvite).toBe(false);
      expect(caps.canUpdateRole).toBe(false);
      expect(caps.canRemoveMember).toBe(false);
      expect(caps.canCreateBoard).toBe(false);
      expect(caps.canEditOrg).toBe(false);
    });

    it("evaluates pending invitations as null role and false for all capabilities, even if invited as admin", () => {
      // Pending admin
      useOrgStore.setState({ activeOrgId: "org-pending-admin", memberships: sampleMemberships });
      const pendingAdmin = evaluateUseRole();
      expect(pendingAdmin.role).toBeNull();
      expect(pendingAdmin.isAdmin).toBe(false);
      expect(pendingAdmin.canManageMembers).toBe(false);
      expect(pendingAdmin.canInvite).toBe(false);
      expect(pendingAdmin.canCreateBoard).toBe(false);

      // Pending employee
      useOrgStore.setState({ activeOrgId: "org-pending-emp", memberships: sampleMemberships });
      const pendingEmp = evaluateUseRole();
      expect(pendingEmp.role).toBeNull();
      expect(pendingEmp.isEmployee).toBe(false);
      expect(pendingEmp.canCreateBoard).toBe(false);

      // Pending contributor
      useOrgStore.setState({ activeOrgId: "org-pending-contrib", memberships: sampleMemberships });
      const pendingContrib = evaluateUseRole();
      expect(pendingContrib.role).toBeNull();
      expect(pendingContrib.isContributor).toBe(false);
    });

    it("evaluates null role when activeOrgId is null or not found in memberships", () => {
      useOrgStore.setState({ activeOrgId: null, memberships: sampleMemberships });
      const nullOrg = evaluateUseRole();
      expect(nullOrg.role).toBeNull();
      expect(nullOrg.isAdmin).toBe(false);
      expect(nullOrg.isEmployee).toBe(false);
      expect(nullOrg.isContributor).toBe(false);
      expect(nullOrg.canManageMembers).toBe(false);

      useOrgStore.setState({ activeOrgId: "non-existent-org", memberships: sampleMemberships });
      const notFoundOrg = evaluateUseRole();
      expect(notFoundOrg.role).toBeNull();
      expect(notFoundOrg.isAdmin).toBe(false);
    });

    it("fails closed on unrecognized role strings", () => {
      const weirdMembership: UserOrgMembership = {
        id: "mem-weird",
        role: "guest" as OrgRole,
        accepted: true,
        userId: "u-1",
        orgId: "org-weird",
        createdAt: "",
        updatedAt: "",
        acceptedAt: "",
        org: { id: "org-weird", name: "Weird", description: "", visible: true, createdAt: "", updatedAt: "" }
      };
      useOrgStore.setState({ activeOrgId: "org-weird", memberships: [weirdMembership] });
      const caps = evaluateUseRole();

      expect(caps.role).toBe("guest" as OrgRole);
      expect(caps.isAdmin).toBe(false);
      expect(caps.isEmployee).toBe(false);
      expect(caps.isContributor).toBe(false);
      expect(caps.canManageMembers).toBe(false);
      expect(caps.canInvite).toBe(false);
      expect(caps.canUpdateRole).toBe(false);
      expect(caps.canRemoveMember).toBe(false);
      expect(caps.canCreateBoard).toBe(false);
      expect(caps.canEditOrg).toBe(false);
    });

    it("correctly handles state transitions (demotions, promotions, and org switches)", () => {
      // 1. Start as admin in org-admin
      useOrgStore.setState({ activeOrgId: "org-admin", memberships: sampleMemberships });
      expect(evaluateUseRole().isAdmin).toBe(true);

      // 2. Switch to org-employee
      useOrgStore.setState({ activeOrgId: "org-employee" });
      const empState = evaluateUseRole();
      expect(empState.isAdmin).toBe(false);
      expect(empState.isEmployee).toBe(true);
      expect(empState.canCreateBoard).toBe(true);

      // 3. Demote in active org to contributor
      const demotedMemberships = sampleMemberships.map(m =>
        m.orgId === "org-employee" ? { ...m, role: "contributor" as OrgRole } : m
      );
      useOrgStore.setState({ memberships: demotedMemberships });
      const demotedState = evaluateUseRole();
      expect(demotedState.isAdmin).toBe(false);
      expect(demotedState.isEmployee).toBe(false);
      expect(demotedState.isContributor).toBe(true);
      expect(demotedState.canCreateBoard).toBe(false);

      // 4. Target org parameter resolves independently of active org
      const targetAdmin = evaluateUseRole("org-admin");
      expect(targetAdmin.isAdmin).toBe(true);
      expect(targetAdmin.canManageMembers).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. RoleGuard Stress Testing                                                 */
  /* -------------------------------------------------------------------------- */
  describe("2. RoleGuard Rendering & Prop Boundary Testing", () => {
    it("renders children when requiredRole is undefined but user has any accepted role", () => {
      useOrgStore.setState({ activeOrgId: "org-employee", memberships: sampleMemberships });
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          { fallback: React.createElement("span", null, "Denied") },
          React.createElement("button", null, "Visible to Any Member")
        )
      );

      expect(html).toContain("Visible to Any Member");
      expect(html).not.toContain("Denied");
    });

    it("renders fallback when requiredRole is undefined and user has no active role", () => {
      useOrgStore.setState({ activeOrgId: null, memberships: sampleMemberships });
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          { fallback: React.createElement("span", null, "Denied") },
          React.createElement("button", null, "Secret")
        )
      );

      expect(html).toContain("Denied");
      expect(html).not.toContain("Secret");
    });

    it("renders fallback when requiredRole is an empty array", () => {
      useOrgStore.setState({ activeOrgId: "org-admin", memberships: sampleMemberships });
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: [],
            fallback: React.createElement("span", null, "Empty Roles Fallback")
          },
          React.createElement("button", null, "Never Shown")
        )
      );

      expect(html).toContain("Empty Roles Fallback");
      expect(html).not.toContain("Never Shown");
    });

    it("renders children when role matches one of multiple requiredRole array elements", () => {
      useOrgStore.setState({ activeOrgId: "org-employee", memberships: sampleMemberships });
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: ["admin", "employee"],
            fallback: React.createElement("span", null, "Forbidden")
          },
          React.createElement("button", null, "Admin and Employee Action")
        )
      );

      expect(html).toContain("Admin and Employee Action");
      expect(html).not.toContain("Forbidden");
    });

    it("renders fallback when role is not contained in requiredRole array", () => {
      useOrgStore.setState({ activeOrgId: "org-contributor", memberships: sampleMemberships });
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: ["admin", "employee"],
            fallback: React.createElement("span", null, "Forbidden for Contributor")
          },
          React.createElement("button", null, "Admin and Employee Action")
        )
      );

      expect(html).toContain("Forbidden for Contributor");
      expect(html).not.toContain("Admin and Employee Action");
    });

    it("renders empty markup when fallback prop is omitted and user is unauthorized", () => {
      useOrgStore.setState({ activeOrgId: "org-contributor", memberships: sampleMemberships });
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          { requiredRole: "admin" },
          React.createElement("button", null, "Admin Only")
        )
      );

      expect(html).toBe("");
    });

    it("respects explicit orgId prop independently from activeOrgId", () => {
      // Active org is contributor (unauthorized for admin guard)
      useOrgStore.setState({ activeOrgId: "org-contributor", memberships: sampleMemberships });

      // Guard explicitly specifies orgId="org-admin" where user is admin
      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: "admin",
            orgId: "org-admin",
            fallback: React.createElement("span", null, "Denied")
          },
          React.createElement("button", null, "Admin of Org Admin")
        )
      );

      expect(html).toContain("Admin of Org Admin");
      expect(html).not.toContain("Denied");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. MemberManagementModal Sole Admin & Non-Admin Tests                      */
  /* -------------------------------------------------------------------------- */
  describe("3. MemberManagementModal Sole Admin & Role Boundaries", () => {
    function createMockMember(item: {
      role: OrgRole;
      accepted: boolean;
      user: { email: string; username: string };
      orgId?: string;
      acceptedAt?: string | null;
    }): OrgMemberItem {
      return {
        orgId: item.orgId || "org-admin",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        acceptedAt: item.acceptedAt !== undefined ? item.acceptedAt : item.accepted ? "2026-01-01T00:00:00Z" : null,
        ...item
      };
    }

    function renderModalWithMembers(membersList: OrgMemberItem[], orgId = "org-admin") {
      function Harness() {
        const origUseState = internals.H.useState;
        let intercepted = false;
        internals.H.useState = (init: unknown) => {
          if (!intercepted && Array.isArray(init) && init.length === 0) {
            intercepted = true;
            return [membersList, () => {}];
          }
          return origUseState(init);
        };
        return React.createElement(MemberManagementModal, {
          open: true,
          onOpenChange: () => {},
          orgId
        });
      }
      return renderToStaticMarkup(React.createElement(Harness));
    }

    it("locks demotion and removal/leave when current user is the sole admin", () => {
      useAuthStore.setState({
        user: { id: "u-admin", email: "admin@example.com", username: "sole_admin" }
      });
      useOrgStore.setState({ activeOrgId: "org-admin", memberships: sampleMemberships });

      const soleAdminMembers: OrgMemberItem[] = [
        createMockMember({
          role: "admin",
          accepted: true,
          user: { email: "admin@example.com", username: "sole_admin" }
        }),
        createMockMember({
          role: "employee",
          accepted: true,
          user: { email: "emp@example.com", username: "emp_user" }
        })
      ];

      const html = renderModalWithMembers(soleAdminMembers);

      // Verify accessibility and header
      expect(html).toContain("role=\"dialog\"");
      expect(html).toContain("Member Management");
      expect(html).toContain("You are an admin of this organization");

      // Verify admin invite form is accessible
      expect(html).toContain("Invite New Member");
      expect(html).toContain("colleague@example.com");
      expect(html).toContain("Send Invite");

      // Verify sole admin role dropdown is disabled with warning title
      expect(html).toContain("Cannot demote the last remaining admin");

      // Verify sole admin leave button is disabled with warning title
      expect(html).toContain("Cannot leave as the last remaining admin");

      // Verify other member (employee) role can be changed and member can be removed
      expect(html).toContain("Change role");
      expect(html).toContain("Remove");
    });

    it("treats pending admin invites as unaccepted and keeps the sole active admin locked", () => {
      useAuthStore.setState({
        user: { id: "u-admin", email: "admin@example.com", username: "sole_admin" }
      });
      useOrgStore.setState({ activeOrgId: "org-admin", memberships: sampleMemberships });

      const membersWithPendingAdmin: OrgMemberItem[] = [
        createMockMember({
          role: "admin",
          accepted: true,
          user: { email: "admin@example.com", username: "sole_admin" }
        }),
        createMockMember({
          role: "admin",
          accepted: false, // Pending invite!
          user: { email: "invited@example.com", username: "invited_user" }
        })
      ];

      const html = renderModalWithMembers(membersWithPendingAdmin);

      // Even though there are 2 members with role 'admin', activeAdminCount is 1 because second is accepted: false!
      expect(html).toContain("Cannot demote the last remaining admin");
      expect(html).toContain("Cannot leave as the last remaining admin");
      expect(html).toContain("Pending Invite");
    });

    it("allows demotion and leave when multiple accepted admins exist", () => {
      useAuthStore.setState({
        user: { id: "u-admin1", email: "admin1@example.com", username: "admin_one" }
      });
      useOrgStore.setState({ activeOrgId: "org-admin", memberships: sampleMemberships });

      const multipleAdminMembers: OrgMemberItem[] = [
        createMockMember({
          role: "admin",
          accepted: true,
          user: { email: "admin1@example.com", username: "admin_one" }
        }),
        createMockMember({
          role: "admin",
          accepted: true,
          user: { email: "admin2@example.com", username: "admin_two" }
        })
      ];

      const html = renderModalWithMembers(multipleAdminMembers);

      // Neither admin should be blocked from demotion or leaving by the last-admin guard
      expect(html).not.toContain("Cannot demote the last remaining admin");
      expect(html).not.toContain("Cannot leave as the last remaining admin");
      expect(html).toContain("Change role");
      expect(html).toContain("Leave");
    });

    it("restricts member management UI when current user is a non-admin employee", () => {
      useAuthStore.setState({
        user: { id: "u-emp", email: "emp@example.com", username: "emp_user" }
      });
      useOrgStore.setState({ activeOrgId: "org-employee", memberships: sampleMemberships });

      const membersList: OrgMemberItem[] = [
        createMockMember({
          role: "admin",
          accepted: true,
          orgId: "org-employee",
          user: { email: "admin@example.com", username: "admin_user" }
        }),
        createMockMember({
          role: "employee",
          accepted: true,
          orgId: "org-employee",
          user: { email: "emp@example.com", username: "emp_user" }
        })
      ];

      const html = renderModalWithMembers(membersList, "org-employee");

      // Non-admin status
      expect(html).toContain("Member access");
      expect(html).not.toContain("You are an admin of this organization");

      // Invite form must be absent
      expect(html).not.toContain("Invite New Member");
      expect(html).not.toContain("Send Invite");

      // Role selector must be absent for other members (rendered as badge)
      expect(html).not.toContain("Change role");

      // Employee cannot remove other members
      expect(html).not.toContain("Remove");

      // Employee CAN voluntarily leave organization
      expect(html).toContain("Leave");
      expect(html).not.toContain("Cannot leave as the last remaining admin");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. OrgSwitcher Scaling & State Permutations                                 */
  /* -------------------------------------------------------------------------- */
  describe("4. OrgSwitcher Scaling (0, 1, 10+ Orgs & Pending Invites)", () => {
    it("renders appropriately when user has 0 organizations", () => {
      useOrgStore.setState({
        memberships: [],
        activeOrgId: null
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      // Trigger button label
      expect(html).toContain("Select Organization");
      // Dropdown empty state
      expect(html).toContain("No active organizations");
      // Pending invites badge absent
      expect(html).not.toContain("Invitations");
      // Admin members management absent
      expect(html).not.toContain("Manage Members");
      // Create Organization present
      expect(html).toContain("Create Organization");
    });

    it("renders single organization with checkmark", () => {
      const singleOrg: UserOrgMembership[] = [
        {
          id: "mem-single",
          role: "employee",
          accepted: true,
          userId: "u-1",
          orgId: "org-single",
          createdAt: "",
          updatedAt: "",
          acceptedAt: "",
          org: { id: "org-single", name: "Solo Workspace", description: "", visible: true, createdAt: "", updatedAt: "" }
        }
      ];

      useOrgStore.setState({
        memberships: singleOrg,
        activeOrgId: "org-single"
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      expect(html).toContain("Solo Workspace");
      expect(html).not.toContain("No active organizations");
      // Employee role: Manage Members should be hidden
      expect(html).not.toContain("Manage Members");
    });

    it("renders scale of 10+ organizations with active checkmark on selected org", () => {
      const manyMemberships: UserOrgMembership[] = Array.from({ length: 15 }, (_, i) => ({
        id: `mem-${i + 1}`,
        role: (i === 0 ? "admin" : "employee") as OrgRole,
        accepted: true,
        userId: "u-1",
        orgId: `org-${i + 1}`,
        createdAt: "",
        updatedAt: "",
        acceptedAt: "",
        org: {
          id: `org-${i + 1}`,
          name: `Enterprise Division ${i + 1}`,
          description: `Division ${i + 1} desc`,
          visible: true,
          createdAt: "",
          updatedAt: ""
        }
      }));

      useOrgStore.setState({
        memberships: manyMemberships,
        activeOrgId: "org-1"
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      // Verify active org name in trigger
      expect(html).toContain("Enterprise Division 1");
      // Verify all 15 orgs appear in dropdown
      for (let i = 1; i <= 15; i++) {
        expect(html).toContain(`Enterprise Division ${i}`);
      }
      // Since active is admin, Manage Members is shown
      expect(html).toContain("Manage Members");
      expect(html).toContain("Create Organization");
    });

    it("renders pending invitations count in header and dropdown menu", () => {
      const pendingMemberships: UserOrgMembership[] = [
        sampleMemberships[0]!, // 1 accepted admin
        sampleMemberships[3]!, // pending 1
        sampleMemberships[4]!, // pending 2
        sampleMemberships[5]!  // pending 3
      ];

      useOrgStore.setState({
        memberships: pendingMemberships,
        activeOrgId: "org-admin"
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      // 3 pending invites: header button with badge "3"
      expect(html).toContain("3 pending invitations");
      expect(html).toContain("Invitations");
      expect(html).toContain("Manage Members");
    });

    it("omits pending invitations button when pending count is 0", () => {
      useOrgStore.setState({
        memberships: [sampleMemberships[0]!], // 1 accepted org, 0 pending
        activeOrgId: "org-admin"
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      expect(html).not.toContain("pending invitation");
      expect(html).not.toContain("Invitations");
    });
  });
});
