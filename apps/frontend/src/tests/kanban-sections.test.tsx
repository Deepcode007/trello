import { describe, it, expect, beforeEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock Radix portals for static SSR rendering in Bun
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
  DropdownMenuItem: ({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: () => void }) =>
    React.createElement("div", { className, "data-slot": "dropdown-item", onClick }, children)
}));

import { KanbanCanvas } from "../components/board/KanbanCanvas";
import { KanbanColumn } from "../components/board/KanbanColumn";
import { CreateColumnModal } from "../components/board/CreateColumnModal";
import { EditColumnModal } from "../components/board/EditColumnModal";
import { DeleteColumnModal } from "../components/board/DeleteColumnModal";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import type { BoardDetail, BoardSection } from "../lib/board-api";
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

describe("R1: Section Column Workflow & WIP Limits Management", () => {
  const adminMembership: UserOrgMembership = {
    id: "mem-admin",
    role: "admin",
    accepted: true,
    userId: "u-admin",
    orgId: "org-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: {
      id: "org-1",
      name: "Engineering",
      description: "Dev Team",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const contributorMembership: UserOrgMembership = {
    ...adminMembership,
    id: "mem-contrib",
    role: "contributor"
  };

  beforeEach(() => {
    // Monkey-patch useSyncExternalStore for Zustand in React 19 SSR
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    useOrgStore.getState().resetOrgState();
    useOrgStore.setState({
      memberships: [adminMembership],
      activeOrgId: "org-1"
    });
    useAuthStore.setState({
      token: "mock-token",
      user: {
        id: "u-admin",
        email: "admin@test.com",
        username: "admin"
      }
    });
  });

  describe("Column Rendering & Position Ordering", () => {
    it("renders empty state when board has no sections", () => {
      const emptyBoard: BoardDetail = {
        id: "b-1",
        title: "Empty Board",
        description: null,
        color: null,
        isArchived: false,
        orgId: "org-1",
        section: []
      };

      const html = renderWithProviders(<KanbanCanvas board={emptyBoard} />);
      expect(html).toContain('data-testid="canvas-empty-columns"');
      expect(html).toContain("Canvas Ready");
      expect(html).toContain("Add Column");
    });

    it("renders columns in ascending position order", () => {
      const mockBoard: BoardDetail = {
        id: "b-1",
        title: "Active Board",
        description: null,
        color: null,
        isArchived: false,
        orgId: "org-1",
        section: [
          {
            id: "sec-3",
            title: "Done",
            position: 3000,
            isArchived: false,
            issues: []
          },
          {
            id: "sec-1",
            title: "To Do",
            position: 1000,
            isArchived: false,
            issues: []
          },
          {
            id: "sec-2",
            title: "In Progress",
            position: 2000,
            isArchived: false,
            issues: []
          }
        ]
      };

      const html = renderWithProviders(<KanbanCanvas board={mockBoard} />);
      expect(html).toContain('data-testid="column-sec-1"');
      expect(html).toContain('data-testid="column-sec-2"');
      expect(html).toContain('data-testid="column-sec-3"');

      // Assert ascending order in HTML string
      const idx1 = html.indexOf('data-testid="column-sec-1"');
      const idx2 = html.indexOf('data-testid="column-sec-2"');
      const idx3 = html.indexOf('data-testid="column-sec-3"');
      expect(idx1 < idx2).toBe(true);
      expect(idx2 < idx3).toBe(true);
    });
  });

  describe("WIP Limit Indicators & Warning Banners", () => {
    it("renders normal card count without warning when WIP limit is null", () => {
      const section: BoardSection = {
        id: "sec-unlimited",
        title: "Backlog",
        position: 1000,
        wipLimit: null,
        isArchived: false,
        issues: [
          {
            id: "c-1",
            title: "Card 1",
            position: 1000,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-unlimited"
          }
        ]
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={section}
          boardId="b-1"
          orgId="org-1"
          allSections={[section]}
        />
      );

      expect(html).toContain("Backlog");
      expect(html).toContain(">1<");
      expect(html).not.toContain('data-testid="wip-limit-warning"');
    });

    it("renders cardCount / wipLimit without warning when issues <= wipLimit", () => {
      const section: BoardSection = {
        id: "sec-within",
        title: "Doing",
        position: 1000,
        wipLimit: 3,
        isArchived: false,
        issues: [
          {
            id: "c-1",
            title: "Card 1",
            position: 1000,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-within"
          },
          {
            id: "c-2",
            title: "Card 2",
            position: 2000,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-within"
          }
        ]
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={section}
          boardId="b-1"
          orgId="org-1"
          allSections={[section]}
        />
      );

      expect(html).toContain("2 / 3");
      expect(html).not.toContain('data-testid="wip-limit-warning"');
    });

    it("renders warning badge with data-testid='wip-limit-warning' when issues > wipLimit", () => {
      const section: BoardSection = {
        id: "sec-exceeded",
        title: "Review",
        position: 1000,
        wipLimit: 2,
        isArchived: false,
        issues: [
          {
            id: "c-1",
            title: "Card 1",
            position: 1000,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-exceeded"
          },
          {
            id: "c-2",
            title: "Card 2",
            position: 2000,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-exceeded"
          },
          {
            id: "c-3",
            title: "Card 3",
            position: 3000,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-exceeded"
          }
        ]
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={section}
          boardId="b-1"
          orgId="org-1"
          allSections={[section]}
        />
      );

      expect(html).toContain('data-testid="wip-limit-warning"');
      expect(html).toContain("3 / 2");
    });
  });

  describe("CreateColumnModal & Role Enforcement", () => {
    it("renders form inputs for authorized admin/employee", () => {
      const html = renderWithProviders(
        <CreateColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
        />
      );

      expect(html).toContain('data-testid="create-column-dialog"');
      expect(html).toContain('data-testid="create-column-title-input"');
      expect(html).toContain('data-testid="create-column-wip-input"');
      expect(html).toContain('data-testid="create-column-submit-button"');
      expect(html).not.toContain("Only organization admins and employees can add columns");
    });

    it("renders restriction banner for contributor and disables submission", () => {
      useOrgStore.setState({ memberships: [contributorMembership] });

      const html = renderWithProviders(
        <CreateColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
        />
      );

      expect(html).toContain("Only organization admins and employees can add columns");
      expect(html).toContain("disabled");
    });
  });

  describe("EditColumnModal", () => {
    it("prepopulates current title and wip limit", () => {
      const section: BoardSection = {
        id: "sec-1",
        title: "Testing Column",
        position: 1000,
        wipLimit: 5,
        isArchived: false,
        issues: []
      };

      const html = renderWithProviders(
        <EditColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          section={section}
        />
      );

      expect(html).toContain('data-testid="edit-column-dialog"');
      expect(html).toContain('value="Testing Column"');
      expect(html).toContain('value="5"');
      expect(html).toContain('data-testid="edit-column-submit-button"');
    });
  });

  describe("DeleteColumnModal Guardrails & Reassignment", () => {
    it("renders direct deletion prompt when column has zero issues", () => {
      const emptySection: BoardSection = {
        id: "sec-empty",
        title: "Empty Column",
        position: 1000,
        wipLimit: null,
        isArchived: false,
        issues: []
      };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={emptySection}
          allSections={[emptySection]}
        />
      );

      expect(html).toContain('data-testid="delete-column-dialog"');
      expect(html).toContain('data-testid="confirm-delete-column-button"');
      expect(html).toContain("This column is empty");
      expect(html).not.toContain('data-testid="target-section-select"');
    });

    it("renders reassign issues modal with target selection when column has issues and alternatives exist", () => {
      const targetSection: BoardSection = {
        id: "sec-target",
        title: "Target Column",
        position: 2000,
        wipLimit: null,
        isArchived: false,
        issues: []
      };

      const sectionWithCards: BoardSection = {
        id: "sec-cards",
        title: "Source Column",
        position: 1000,
        wipLimit: null,
        isArchived: false,
        issues: [
          {
            id: "c-1",
            title: "Card 1",
            position: 1000,
            priority: "low",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-cards"
          }
        ]
      };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={sectionWithCards}
          allSections={[sectionWithCards, targetSection]}
        />
      );

      expect(html).toContain('data-testid="reassign-issues-modal"');
      expect(html).toContain('data-testid="target-section-select"');
      expect(html).toContain("Target Column");
      expect(html).toContain('data-testid="confirm-delete-column-button"');
      // Source column should not be listed as target option
      expect(html).not.toContain('<option value="sec-cards">Source Column</option>');
    });

    it("prevents deletion and displays warning when non-empty column is the sole column on board", () => {
      const soleSectionWithCards: BoardSection = {
        id: "sec-sole",
        title: "Sole Column",
        position: 1000,
        wipLimit: null,
        isArchived: false,
        issues: [
          {
            id: "c-1",
            title: "Card 1",
            position: 1000,
            priority: "urgent",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-sole"
          }
        ]
      };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={soleSectionWithCards}
          allSections={[soleSectionWithCards]}
        />
      );

      expect(html).toContain("Cannot delete the only column containing cards");
      expect(html).toContain('data-testid="confirm-delete-column-button"');
      expect(html).toContain("disabled");
    });

    it("strictly prevents non-admin (employee) from executing column deletion", () => {
      const employeeMembership: UserOrgMembership = {
        ...adminMembership,
        id: "mem-emp",
        role: "employee"
      };
      useOrgStore.setState({ memberships: [employeeMembership] });

      const emptySection: BoardSection = {
        id: "sec-empty",
        title: "Empty Column",
        position: 1000,
        wipLimit: null,
        isArchived: false,
        issues: []
      };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={emptySection}
          allSections={[emptySection]}
        />
      );

      expect(html).toContain("Only organization admins can delete columns");
      expect(html).toContain("disabled");
    });
  });
});
