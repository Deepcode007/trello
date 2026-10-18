import { describe, it, expect, beforeEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as RealDialogUI from "../components/ui/dialog";

// Mock DialogPortal for server-side static rendering without DOM portal mounting
mock.module("../components/ui/dialog", () => ({
  ...RealDialogUI,
  DialogPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
}));

import { RoleGuard } from "../components/auth/RoleGuard";
import { OrgSwitcher } from "../components/org/OrgSwitcher";
import { CreateOrgModal } from "../components/org/CreateOrgModal";
import { PendingInvitesModal } from "../components/org/PendingInvitesModal";
import { MemberManagementModal } from "../components/org/MemberManagementModal";
import { useOrgStore } from "../store/useOrgStore";
import type { OrgRole, UserOrgMembership } from "../lib/org-api";

// Typed component helper allowing children to be passed as additional arguments without violating react/no-children-prop
const Guard = RoleGuard as unknown as (props: {
  requiredRole?: OrgRole | OrgRole[];
  fallback?: React.ReactNode;
  orgId?: string;
}) => React.ReactElement | null;

describe("Organization UI Components and Role Guards", () => {
  beforeEach(() => {
    // Ensure useSyncExternalStore resolves latest Zustand state in renderToStaticMarkup
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();
    useOrgStore.getState().resetOrgState();
  });

  const testMemberships: UserOrgMembership[] = [
    {
      id: "mem-1",
      role: "admin",
      accepted: true,
      userId: "u-1",
      orgId: "org-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      acceptedAt: "2026-01-01T00:00:00Z",
      org: {
        id: "org-1",
        name: "Acme Corporation",
        description: "Main workspace",
        visible: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      }
    },
    {
      id: "mem-2",
      role: "employee",
      accepted: true,
      userId: "u-1",
      orgId: "org-2",
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      acceptedAt: "2026-01-02T00:00:00Z",
      org: {
        id: "org-2",
        name: "Beta Engineering",
        description: "R&D team workspace",
        visible: false,
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z"
      }
    },
    {
      id: "mem-3",
      role: "contributor",
      accepted: false,
      userId: "u-1",
      orgId: "org-3",
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
      acceptedAt: null,
      org: {
        id: "org-3",
        name: "Gamma Community",
        description: "Open contributor board",
        visible: true,
        createdAt: "2026-02-01T00:00:00Z",
        updatedAt: "2026-02-01T00:00:00Z"
      }
    }
  ];

  describe("RoleGuard", () => {
    it("renders children when role exactly matches single requiredRole", () => {
      useOrgStore.setState({
        activeOrgId: "org-1",
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: "admin",
            fallback: React.createElement("span", null, "Access Denied")
          },
          React.createElement("button", { id: "admin-delete-btn" }, "Delete Org")
        )
      );

      expect(html).toContain("Delete Org");
      expect(html).not.toContain("Access Denied");
    });

    it("renders children when role is included in requiredRole array", () => {
      useOrgStore.setState({
        activeOrgId: "org-2", // role: employee
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: ["admin", "employee"],
            fallback: React.createElement("span", null, "Restricted")
          },
          React.createElement("button", { id: "create-board-btn" }, "New Board")
        )
      );

      expect(html).toContain("New Board");
      expect(html).not.toContain("Restricted");
    });

    it("renders fallback when user role does not meet requiredRole criteria", () => {
      useOrgStore.setState({
        activeOrgId: "org-2", // role: employee
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: "admin",
            fallback: React.createElement("div", { className: "forbidden-banner" }, "Admins Only")
          },
          React.createElement("button", null, "Secret Settings")
        )
      );

      expect(html).toContain("Admins Only");
      expect(html).not.toContain("Secret Settings");
    });

    it("renders empty markup when role check fails and no fallback is provided", () => {
      useOrgStore.setState({
        activeOrgId: "org-2", // role: employee
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          { requiredRole: "admin" },
          React.createElement("button", null, "Admin Secret")
        )
      );

      expect(html).toBe("");
    });

    it("renders fallback when user has no active organization (role is null)", () => {
      useOrgStore.setState({
        activeOrgId: null,
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            requiredRole: "admin",
            fallback: React.createElement("p", null, "No Org Selected")
          },
          React.createElement("div", null, "Protected Content")
        )
      );

      expect(html).toContain("No Org Selected");
      expect(html).not.toContain("Protected Content");
    });

    it("evaluates explicit orgId independently from current activeOrgId", () => {
      useOrgStore.setState({
        activeOrgId: "org-2", // employee
        memberships: testMemberships
      });

      // Target org-1 where user is admin
      const htmlAdmin = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            orgId: "org-1",
            requiredRole: "admin",
            fallback: "No Admin"
          },
          "Admin Approved"
        )
      );
      expect(htmlAdmin).toContain("Admin Approved");

      // Target org-2 where user is employee (not admin)
      const htmlEmployee = renderToStaticMarkup(
        React.createElement(
          Guard,
          {
            orgId: "org-2",
            requiredRole: "admin",
            fallback: "No Admin"
          },
          "Admin Approved"
        )
      );
      expect(htmlEmployee).toContain("No Admin");
    });
  });

  describe("OrgSwitcher", () => {
    it("renders active organization name and switcher dropdown trigger button", () => {
      useOrgStore.setState({
        activeOrgId: "org-1",
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      expect(html).toContain("Acme Corporation");
      expect(html).toContain("lucide-building2");
      expect(html).toContain("lucide-chevron-down");
    });

    it("renders fallback 'Select Organization' placeholder when activeOrg is null", () => {
      useOrgStore.setState({
        activeOrgId: null,
        memberships: []
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      expect(html).toContain("Select Organization");
    });

    it("renders dedicated pending invitations badge button when pending invites exist", () => {
      useOrgStore.setState({
        activeOrgId: "org-1",
        memberships: testMemberships // Has 1 pending invite (org-3)
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      expect(html).toContain("1 pending invitation");
      expect(html).toContain("lucide-mail");
      expect(html).toContain("<span>1</span>");
    });

    it("omits pending invitations badge button when user has 0 pending invites", () => {
      useOrgStore.setState({
        activeOrgId: "org-1",
        memberships: [testMemberships[0]!, testMemberships[1]!] // Only accepted memberships
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher));

      expect(html).not.toContain("pending invitation");
      expect(html).not.toContain("lucide-mail");
    });

    it("applies custom className to container", () => {
      useOrgStore.setState({
        activeOrgId: "org-1",
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(React.createElement(OrgSwitcher, { className: "custom-nav-switcher" }));
      expect(html).toContain("custom-nav-switcher");
    });
  });

  describe("CreateOrgModal", () => {
    it("renders nothing when open is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(CreateOrgModal, { open: false, onOpenChange: () => {} })
      );
      expect(html).toBe("");
    });

    it("renders dialog header, form inputs, visibility checkbox, and action buttons when open is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(CreateOrgModal, { open: true, onOpenChange: () => {} })
      );

      // Dialog accessibility markup
      expect(html).toContain('role="dialog"');
      expect(html).toContain("Create Organization");
      expect(html).toContain("Set up a new workspace for your team and boards.");

      // Form fields
      expect(html).toContain('id="org-name"');
      expect(html).toContain('placeholder="e.g. Acme Engineering"');
      expect(html).toContain('id="org-description"');
      expect(html).toContain('placeholder="Brief summary of this team or organization"');

      // Visibility checkbox
      expect(html).toContain('id="org-visible"');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain("Make organization publicly visible");

      // Action buttons
      expect(html).toContain("Cancel");
      expect(html).toContain("Create Organization");
    });
  });

  describe("PendingInvitesModal", () => {
    it("renders nothing when open is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(PendingInvitesModal, { open: false, onOpenChange: () => {} })
      );
      expect(html).toBe("");
    });

    it("renders empty state illustration and message when user has zero pending invitations", () => {
      useOrgStore.setState({
        memberships: [testMemberships[0]!] // only accepted
      });

      const html = renderToStaticMarkup(
        React.createElement(PendingInvitesModal, { open: true, onOpenChange: () => {} })
      );

      expect(html).toContain("Pending Invitations");
      expect(html).toContain("Review and accept invitations to join organizations.");
      expect(html).toContain("No pending invitations");
      expect(html).toContain("You&#x27;re all caught up!");
      expect(html).toContain("Close");
    });

    it("renders list of invitations with organization name, description, role badge, and Accept button", () => {
      useOrgStore.setState({
        memberships: testMemberships // org-3 is pending contributor
      });

      const html = renderToStaticMarkup(
        React.createElement(PendingInvitesModal, { open: true, onOpenChange: () => {} })
      );

      expect(html).toContain("Pending Invitations");
      expect(html).toContain("Gamma Community");
      expect(html).toContain("Open contributor board");
      expect(html).toContain("contributor");
      expect(html).toContain("Accept");
      expect(html).toContain("Close");
    });
  });

  describe("MemberManagementModal", () => {
    it("renders nothing when open is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(MemberManagementModal, { open: false, onOpenChange: () => {}, orgId: "org-1" })
      );
      expect(html).toBe("");
    });

    it("renders admin invite form and admin status when user has admin role in organization", () => {
      useOrgStore.setState({
        activeOrgId: "org-1",
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(MemberManagementModal, { open: true, onOpenChange: () => {}, orgId: "org-1" })
      );

      expect(html).toContain("Member Management");
      expect(html).toContain("Acme Corporation");

      // Admin Invite Form
      expect(html).toContain("Invite New Member");
      expect(html).toContain('placeholder="colleague@example.com"');
      expect(html).toContain("Send Invite");

      // Members section and footer
      expect(html).toContain("Members &amp; Invites");
      expect(html).toContain("You are an admin of this organization");
      expect(html).toContain("Done");
    });

    it("hides invite form and displays restricted status text when user is not an admin", () => {
      useOrgStore.setState({
        activeOrgId: "org-2", // employee role
        memberships: testMemberships
      });

      const html = renderToStaticMarkup(
        React.createElement(MemberManagementModal, { open: true, onOpenChange: () => {}, orgId: "org-2" })
      );

      expect(html).toContain("Member Management");
      expect(html).toContain("Beta Engineering");

      // Admin Invite Form must NOT be visible
      expect(html).not.toContain("Invite New Member");
      expect(html).not.toContain("Send Invite");
      expect(html).not.toContain('placeholder="colleague@example.com"');

      // Status text indicates non-admin member access
      expect(html).toContain("Member access");
      expect(html).not.toContain("You are an admin of this organization");
      expect(html).toContain("Done");
    });
  });
});
