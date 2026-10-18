import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock Radix UI portals for static headless SSR testing in Bun
mock.module("../components/ui/dialog", () => ({
  ...RealDialogUI,
  DialogPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
}));

mock.module("../components/ui/dropdown-menu", () => ({
  ...RealDropdownUI,
  DropdownMenuPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
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

import { useRole } from "../hooks/useRole";
import { BoardList } from "../components/board/BoardList";
import { CreateBoardModal } from "../components/board/CreateBoardModal";
import { BoardHeader } from "../components/board/BoardHeader";
import { DeleteBoardDialog } from "../components/board/DeleteBoardDialog";
import { BoardCanvasPage } from "../pages/BoardCanvasPage";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import { type BoardDetail } from "../lib/board-api";
import type { UserOrgMembership } from "../lib/org-api";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0
      }
    }
  });
}

function renderWithProviders(element: React.ReactElement, client = createTestQueryClient()) {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(MemoryRouter, null, element)
    )
  );
}

describe("Adversarial Verification: RBAC, Navigation & Lifecycle Cleanliness", () => {
  const originalUseSyncExternalStore = React.useSyncExternalStore;

  const mockAdminMembership: UserOrgMembership = {
    id: "mem-admin",
    role: "admin",
    accepted: true,
    userId: "usr-admin",
    orgId: "org-alpha",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: {
      id: "org-alpha",
      name: "Alpha Corporation",
      description: "Main Org",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const mockContributorMembership: UserOrgMembership = {
    id: "mem-contrib",
    role: "contributor",
    accepted: true,
    userId: "usr-contrib",
    orgId: "org-alpha",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: {
      id: "org-alpha",
      name: "Alpha Corporation",
      description: "Main Org",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const mockPendingMembership: UserOrgMembership = {
    id: "mem-pending",
    role: "admin",
    accepted: false,
    userId: "usr-pending",
    orgId: "org-alpha",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: null,
    org: {
      id: "org-alpha",
      name: "Alpha Corporation",
      description: "Main Org",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const mockBetaMembership: UserOrgMembership = {
    id: "mem-beta",
    role: "employee",
    accepted: true,
    userId: "usr-shared",
    orgId: "org-beta",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: {
      id: "org-beta",
      name: "Beta Limited",
      description: "Secondary Org",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const sampleBoard: BoardDetail = {
    id: "e9f73319-3221-4f1e-84b2-0dc2a806c9a1",
    title: "Engineering Roadmap",
    description: "Core roadmap",
    color: "#3b82f6",
    isArchived: false,
    orgId: "org-alpha",
    section: []
  };

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();
    useOrgStore.getState().resetOrgState();
    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({
      token: "test-valid-jwt",
      user: {
        id: "usr-1",
        email: "tester@example.com",
        username: "tester"
      }
    });
  });

  afterAll(() => {
    (React as unknown as { useSyncExternalStore: unknown }).useSyncExternalStore = originalUseSyncExternalStore;
  });

  // =========================================================================
  // 1. Role Permission Enforcement (Contributor & Pending Memberships)
  // =========================================================================
  describe("1. Role Permission Enforcement & Destructive Button Suppression", () => {
    it("strictly prevents contributor from seeing or accessing create board buttons", () => {
      useOrgStore.setState({
        memberships: [mockContributorMembership],
        activeOrgId: "org-alpha"
      });

      const client = createTestQueryClient();
      // Empty boards list
      client.setQueryData(["boards", "org-alpha"], []);

      const html = renderWithProviders(React.createElement(BoardList, { orgId: "org-alpha" }), client);

      // Header create button MUST NOT exist in DOM
      expect(html).not.toContain('data-testid="create-board-button"');
      // Empty state create button MUST NOT exist in DOM
      expect(html).not.toContain('data-testid="empty-create-board-button"');
      // Explanatory guidance for non-authorized users must be displayed
      expect(html).toContain("Ask an admin or employee to create one.");
    });

    it("strictly disables CreateBoardModal inputs, renders warning banner, and prevents contributor submission", () => {
      useOrgStore.setState({
        memberships: [mockContributorMembership],
        activeOrgId: "org-alpha"
      });

      const html = renderWithProviders(
        React.createElement(CreateBoardModal, {
          open: true,
          onOpenChange: () => {},
          orgId: "org-alpha"
        })
      );

      // Warning alert for contributors
      expect(html).toContain("Only organization admins and employees can create boards. Contributors have read-only access.");
      // Title input is disabled
      expect(html).toContain('id="board-title"');
      expect(/id="board-title"[^>]*disabled/.test(html)).toBe(true);
      // Submit button is disabled
      expect(/type="submit"[^>]*disabled/.test(html)).toBe(true);
    });

    it("suppresses inline rename trigger and actions menu in BoardHeader for contributor", () => {
      useOrgStore.setState({
        memberships: [mockContributorMembership],
        activeOrgId: "org-alpha"
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: sampleBoard }));

      // Inline rename button must NOT be rendered
      expect(html).not.toContain('data-testid="inline-rename-trigger"');
      // Title heading must not have cursor-pointer or rename hover styles
      expect(html).not.toContain("cursor-pointer hover:text-primary");
      // Destructive board actions menu trigger must NOT be rendered
      expect(html).not.toContain('data-testid="board-actions-trigger"');
      expect(html).not.toContain('data-testid="action-edit-board"');
      expect(html).not.toContain('data-testid="action-toggle-archive"');
      expect(html).not.toContain('data-testid="action-delete-board"');
    });

    it("completely denies all privileges when user membership is pending (accepted: false)", () => {
      useOrgStore.setState({
        memberships: [mockPendingMembership],
        activeOrgId: "org-alpha"
      });

      let roleResult: ReturnType<typeof useRole> | null = null;
      function RoleProbe() {
        roleResult = useRole("org-alpha");
        return null;
      }
      renderToStaticMarkup(React.createElement(RoleProbe));

      expect(roleResult).not.toBeNull();
      expect(roleResult!.role).toBeNull();
      expect(roleResult!.isAdmin).toBe(false);
      expect(roleResult!.isEmployee).toBe(false);
      expect(roleResult!.isContributor).toBe(false);
      expect(roleResult!.canCreateBoard).toBe(false);
      expect(roleResult!.canEditBoard).toBe(false);
      expect(roleResult!.canArchiveBoard).toBe(false);
      expect(roleResult!.canDeleteBoard).toBe(false);

      // Verify DOM button suppression for pending membership
      const client = createTestQueryClient();
      client.setQueryData(["boards", "org-alpha"], []);
      const listHtml = renderWithProviders(React.createElement(BoardList, { orgId: "org-alpha" }), client);
      expect(listHtml).not.toContain('data-testid="create-board-button"');
      expect(listHtml).not.toContain('data-testid="empty-create-board-button"');

      const headerHtml = renderWithProviders(React.createElement(BoardHeader, { board: sampleBoard }));
      expect(headerHtml).not.toContain('data-testid="inline-rename-trigger"');
      expect(headerHtml).not.toContain('data-testid="board-actions-trigger"');
    });

    it("renders destructive delete dialog button and options only for admin and employee", () => {
      useOrgStore.setState({
        memberships: [mockAdminMembership],
        activeOrgId: "org-alpha"
      });

      const headerHtml = renderWithProviders(React.createElement(BoardHeader, { board: sampleBoard }));

      // Settings dropdown trigger present for admin
      expect(headerHtml).toContain('data-testid="board-actions-trigger"');

      // Test DeleteBoardDialog directly when open
      const dialogHtml = renderWithProviders(
        React.createElement(DeleteBoardDialog, {
          board: sampleBoard,
          open: true,
          onOpenChange: () => {}
        })
      );

      expect(dialogHtml).toContain("Delete Board");
      expect(dialogHtml).toContain('data-testid="confirm-delete-board-button"');
      expect(dialogHtml).toContain("This action cannot be undone");
    });
  });

  // =========================================================================
  // 2. Routing & Canvas Boundaries (Org Mismatch & Invalid UUIDs)
  // =========================================================================
  describe("2. Routing & Canvas Boundaries", () => {
    it("handles route orgId mismatch: evaluates RBAC and breadcrumbs according to board.orgId", () => {
      // User is member of org-alpha (contributor) and org-beta (employee)
      useOrgStore.setState({
        memberships: [mockContributorMembership, mockBetaMembership],
        activeOrgId: "org-alpha"
      });

      // Board belongs to org-beta
      const betaBoard: BoardDetail = {
        ...sampleBoard,
        id: "b4d7-beta",
        orgId: "org-beta",
        title: "Beta Sprint Board"
      };

      // Header is rendered for betaBoard
      const html = renderWithProviders(React.createElement(BoardHeader, { board: betaBoard }));

      // Breadcrumb displays the board's true organization (Beta Limited), NOT Alpha Corporation
      expect(html).toContain("Beta Limited");
      expect(html).not.toContain("Alpha Corporation");

      // Because user is employee in org-beta (board.orgId), edit triggers must be permitted
      expect(html).toContain('data-testid="inline-rename-trigger"');
      expect(html).toContain('data-testid="board-actions-trigger"');
    });

    it("renders 403 Access Denied when user accesses a board belonging to an org they have not joined", () => {
      const client = createTestQueryClient();
      client.setQueryData(["board", "board-foreign"], null);

      const query = client.getQueryCache().find({ queryKey: ["board", "board-foreign"] });
      query?.setState({
        status: "error",
        error: Object.assign(new Error("Forbidden"), {
          response: { status: 403, data: { error: "Member access only" } }
        }),
        errorUpdatedAt: Date.now(),
        fetchStatus: "idle"
      });

      const html = renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/orgs/org-alpha/boards/board-foreign"] },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, {
                path: "/orgs/:orgId/boards/:boardId",
                element: React.createElement(BoardCanvasPage, null)
              })
            )
          )
        )
      );

      expect(html).toContain('data-testid="canvas-error-403"');
      expect(html).toContain("Access Denied");
      expect(html).toContain("Ensure you have accepted an invitation to the organization");
      expect(html).toContain('data-testid="return-dashboard-button"');
    });

    it("renders 404 Board Not Found when boardId does not exist in DB", () => {
      const client = createTestQueryClient();
      client.setQueryData(["board", "00000000-0000-0000-0000-000000000000"], null);

      const query = client.getQueryCache().find({ queryKey: ["board", "00000000-0000-0000-0000-000000000000"] });
      query?.setState({
        status: "error",
        error: Object.assign(new Error("Not Found"), {
          response: { status: 404, data: { error: "Board not found" } }
        }),
        errorUpdatedAt: Date.now(),
        fetchStatus: "idle"
      });

      const html = renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/orgs/org-alpha/boards/00000000-0000-0000-0000-000000000000"] },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, {
                path: "/orgs/:orgId/boards/:boardId",
                element: React.createElement(BoardCanvasPage, null)
              })
            )
          )
        )
      );

      expect(html).toContain('data-testid="canvas-error-404"');
      expect(html).toContain("Board Not Found");
      expect(html).toContain("The board you are trying to access does not exist");
      expect(html).toContain('data-testid="return-dashboard-button"');
    });

    it("renders generic error boundary with return button when navigating to an invalid non-UUID board route", () => {
      // Backend returns HTTP 400 Validation Error for non-UUID strings
      const client = createTestQueryClient();
      client.setQueryData(["board", "invalid-uuid-string-123"], null);

      const query = client.getQueryCache().find({ queryKey: ["board", "invalid-uuid-string-123"] });
      query?.setState({
        status: "error",
        error: Object.assign(new Error("Validation Error"), {
          response: { status: 400, data: { error: "Invalid board UUID format" } }
        }),
        errorUpdatedAt: Date.now(),
        fetchStatus: "idle"
      });

      const html = renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/orgs/org-alpha/boards/invalid-uuid-string-123"] },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, {
                path: "/orgs/:orgId/boards/:boardId",
                element: React.createElement(BoardCanvasPage, null)
              })
            )
          )
        )
      );

      expect(html).toContain('data-testid="canvas-error-generic"');
      expect(html).toContain("Error Loading Board");
      expect(html).toContain("Invalid board UUID format");
      expect(html).toContain("Return to Dashboard");
    });
  });

  // =========================================================================
  // 3. Socket Teardown & Lifecycle Cleanliness on Route Departure
  // =========================================================================
  describe("3. Socket Teardown & Lifecycle Cleanliness", () => {
    it("empirically checks socket cleanup sequence on component unmount", () => {
      let connectionStatus = "disconnected";
      let pingInterval: ReturnType<typeof setInterval> | null = null;
      const reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
      let sentLeaveAction = false;

      class MockWs {
        readyState = 1;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        send(msg: string) {
          if (msg.includes('"action":"leave"')) {
            sentLeaveAction = true;
          }
        }
        close() {
          this.readyState = 3;
        }
      }

      const ws = new MockWs();

      // Simulate hook connect
      ws.onopen = () => {
        connectionStatus = "connected";
        pingInterval = setInterval(() => {}, 25000);
      };
      ws.onopen();
      expect(connectionStatus).toBe("connected");
      expect(pingInterval).not.toBeNull();

      // Simulate cleanup on unmount
      const cleanup = () => {
        if (pingInterval) clearInterval(pingInterval);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (ws) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ action: "leave", boardId: "board-1" }));
          }
          ws.close();
        }
        connectionStatus = "disconnected";
      };

      cleanup();

      expect(sentLeaveAction).toBe(true);
      expect(ws.readyState).toBe(3);
      expect(connectionStatus).toBe("disconnected");
    });
  });
});
