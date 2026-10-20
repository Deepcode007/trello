import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock Radix portals for static SSR rendering in Bun test environment
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

import { KanbanCard, formatCardDate } from "../components/board/KanbanCard";
import { KanbanColumn } from "../components/board/KanbanColumn";
import { DeleteColumnModal } from "../components/board/DeleteColumnModal";
import { CardCommentsSection } from "../components/board/CardDetailModal/CardCommentsSection";
import { kanbanApi, type CommentNode } from "../lib/kanban-api";
import { api } from "../lib/api";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import type { BoardIssue, BoardSection } from "../lib/board-api";
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

describe("Empirical Challenger: Step 5 Kanban Core Boundary & Adversarial Verification", () => {
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
      name: "Acme Corp",
      description: "Adversarial Test Org",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const employeeMembership: UserOrgMembership = {
    ...adminMembership,
    id: "mem-emp",
    role: "employee",
    userId: "u-emp"
  };

  const contributorMembership: UserOrgMembership = {
    ...adminMembership,
    id: "mem-contrib",
    role: "contributor",
    userId: "u-contrib"
  };

  beforeEach(() => {
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

  describe("1. Empirical Boundary Analysis: WIP Limit Calculation", () => {
    it("handles wipLimit = 0 boundary: 0 cards has no warning, 1 card triggers warning", () => {
      const sectionZeroCards: BoardSection = {
        id: "s-zero-0",
        title: "Zero Limit Empty",
        position: 1000,
        wipLimit: 0,
        isArchived: false,
        issues: []
      };

      const htmlZero = renderWithProviders(
        <KanbanColumn
          section={sectionZeroCards}
          boardId="b-1"
          orgId="org-1"
          allSections={[sectionZeroCards]}
        />
      );
      expect(htmlZero).toContain("0 / 0");
      expect(htmlZero).not.toContain('data-testid="wip-limit-warning"');

      const sectionOneCard: BoardSection = {
        id: "s-zero-1",
        title: "Zero Limit Exceeded",
        position: 1000,
        wipLimit: 0,
        isArchived: false,
        issues: [
          {
            id: "iss-1",
            title: "Task in zero limit column",
            position: 1000,
            priority: "low",
            isArchived: false,
            boardId: "b-1",
            sectionId: "s-zero-1"
          }
        ]
      };

      const htmlOne = renderWithProviders(
        <KanbanColumn
          section={sectionOneCard}
          boardId="b-1"
          orgId="org-1"
          allSections={[sectionOneCard]}
        />
      );
      expect(htmlOne).toContain('data-testid="wip-limit-warning"');
      expect(htmlOne).toContain("1 / 0");
    });

    it("handles large WIP limit (100): count=99 (no warn), count=100 (no warn), count=101 (warn)", () => {
      const createSectionWithCount = (count: number, limit = 100): BoardSection => ({
        id: `s-wip-${count}`,
        title: `Column ${count}`,
        position: 1000,
        wipLimit: limit,
        isArchived: false,
        issues: Array.from({ length: count }, (_, i) => ({
          id: `c-${i}`,
          title: `Card ${i}`,
          position: (i + 1) * 100,
          priority: "medium",
          isArchived: false,
          boardId: "b-1",
          sectionId: `s-wip-${count}`
        }))
      });

      // 99 cards with limit 100
      const html99 = renderWithProviders(
        <KanbanColumn
          section={createSectionWithCount(99, 100)}
          boardId="b-1"
          orgId="org-1"
          allSections={[]}
        />
      );
      expect(html99).toContain("99 / 100");
      expect(html99).not.toContain('data-testid="wip-limit-warning"');

      // 100 cards with limit 100 (boundary)
      const html100 = renderWithProviders(
        <KanbanColumn
          section={createSectionWithCount(100, 100)}
          boardId="b-1"
          orgId="org-1"
          allSections={[]}
        />
      );
      expect(html100).toContain("100 / 100");
      expect(html100).not.toContain('data-testid="wip-limit-warning"');

      // 101 cards with limit 100 (exceeded)
      const html101 = renderWithProviders(
        <KanbanColumn
          section={createSectionWithCount(101, 100)}
          boardId="b-1"
          orgId="org-1"
          allSections={[]}
        />
      );
      expect(html101).toContain('data-testid="wip-limit-warning"');
      expect(html101).toContain("101 / 100");
    });

    it("verifies issues within KanbanColumn are sorted ascending by position regardless of input order", () => {
      const unsortedSection: BoardSection = {
        id: "sec-unsorted",
        title: "Unsorted Section",
        position: 1000,
        isArchived: false,
        issues: [
          { id: "c-third", title: "Third Card", position: 3000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-unsorted" },
          { id: "c-first", title: "First Card", position: 1000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-unsorted" },
          { id: "c-second", title: "Second Card", position: 2000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-unsorted" }
        ]
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={unsortedSection}
          boardId="b-1"
          orgId="org-1"
          allSections={[unsortedSection]}
        />
      );

      const firstIdx = html.indexOf("First Card");
      const secondIdx = html.indexOf("Second Card");
      const thirdIdx = html.indexOf("Third Card");

      expect(firstIdx).toBeGreaterThan(-1);
      expect(secondIdx).toBeGreaterThan(firstIdx);
      expect(thirdIdx).toBeGreaterThan(secondIdx);
    });
  });

  describe("2. Empirical Boundary Analysis: Column Deletion Guardrails", () => {
    it("strictly prevents deletion if section is the sole column with cards on board", () => {
      const soleSectionWithCards: BoardSection = {
        id: "sec-sole",
        title: "Sole Active Column",
        position: 1000,
        wipLimit: null,
        isArchived: false,
        issues: [
          { id: "iss-x", title: "Important Task", position: 100, priority: "urgent", isArchived: false, boardId: "b-1", sectionId: "sec-sole" }
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

      expect(html).toContain('data-testid="reassign-issues-modal"');
      expect(html).toContain("Cannot delete the only column containing cards");
      expect(html).toContain("Please delete or move cards first");
      expect(html).toContain('data-testid="confirm-delete-column-button"');
      expect(html).toContain("disabled");
    });

    it("allows deletion without reassignment if section has 0 cards, even if it is the only column", () => {
      const soleEmptySection: BoardSection = {
        id: "sec-sole-empty",
        title: "Sole Empty Column",
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
          section={soleEmptySection}
          allSections={[soleEmptySection]}
        />
      );

      expect(html).toContain('data-testid="delete-column-dialog"');
      expect(html).not.toContain('data-testid="reassign-issues-modal"');
      expect(html).toContain("This column is empty. Deleting it will permanently remove it from the board.");
      expect(html).not.toContain("Cannot delete the only column containing cards");
      expect(html).toContain('data-testid="confirm-delete-column-button"');
    });

    it("filters out source section from targetSectionId select options during reassignment", () => {
      const secA: BoardSection = {
        id: "sec-a",
        title: "Source Column A",
        position: 1000,
        isArchived: false,
        issues: [{ id: "c-1", title: "Card 1", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-a" }]
      };
      const secB: BoardSection = { id: "sec-b", title: "Target Column B", position: 2000, isArchived: false, issues: [] };
      const secC: BoardSection = { id: "sec-c", title: "Target Column C", position: 3000, isArchived: false, issues: [] };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={secA}
          allSections={[secA, secB, secC]}
        />
      );

      expect(html).toContain('data-testid="target-section-select"');
      expect(html).toContain("Target Column B");
      expect(html).toContain("Target Column C");
      // Must not allow reassigning to self
      expect(html).not.toContain('<option value="sec-a">Source Column A</option>');
    });

    it("strictly blocks non-admin users (employee & contributor) with warning banner", () => {
      // Test employee
      useOrgStore.setState({ memberships: [employeeMembership] });
      const sec: BoardSection = { id: "sec-1", title: "Col 1", position: 1000, isArchived: false, issues: [] };

      const htmlEmp = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={sec}
          allSections={[sec]}
        />
      );
      expect(htmlEmp).toContain("Only organization admins can delete columns");
      expect(htmlEmp).toContain("disabled");

      // Test contributor
      useOrgStore.setState({ memberships: [contributorMembership] });
      const htmlContrib = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={sec}
          allSections={[sec]}
        />
      );
      expect(htmlContrib).toContain("Only organization admins can delete columns");
      expect(htmlContrib).toContain("disabled");
    });
  });

  describe("3. Empirical Boundary Analysis: Comment 24-Hour Edit/Delete Matrix", () => {
    it("strictly prohibits edit by non-author even within 24h, even if user is admin", () => {
      const client = createTestQueryClient();
      const justNow = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

      const comment: CommentNode = {
        id: "cmt-other",
        description: "Comment by someone else",
        parentId: null,
        createdAt: justNow,
        deletedAt: null,
        user: { id: "u-bob", username: "bob" },
        children: []
      };

      client.setQueryData(["comments", "iss-matrix"], [comment]);

      // Admin (u-admin) viewing Bob's comment
      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-matrix" orgId="org-1" />,
        client
      );

      // Admin CAN delete
      expect(html).toContain('data-testid="delete-comment-cmt-other"');
      // Admin CANNOT edit someone else's comment!
      expect(html).not.toContain('data-testid="edit-comment-cmt-other"');
    });

    it("prohibits non-admin author from deleting own comment after 24h", () => {
      // Set active user as employee (author)
      useOrgStore.setState({ memberships: [employeeMembership] });
      useAuthStore.setState({
        user: { id: "u-emp", email: "emp@test.com", username: "employee_user" }
      });

      const client = createTestQueryClient();
      const expiredDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

      const comment: CommentNode = {
        id: "cmt-emp-expired",
        description: "My old comment from yesterday",
        parentId: null,
        createdAt: expiredDate,
        deletedAt: null,
        user: { id: "u-emp", username: "employee_user" },
        children: []
      };

      client.setQueryData(["comments", "iss-matrix-2"], [comment]);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-matrix-2" orgId="org-1" />,
        client
      );

      // Both edit and delete must be suppressed for author past 24h
      expect(html).not.toContain('data-testid="edit-comment-cmt-emp-expired"');
      expect(html).not.toContain('data-testid="delete-comment-cmt-emp-expired"');
    });

    it("handles deeply nested comment tree (7 levels) with correct indentation and reply anchors", () => {
      const client = createTestQueryClient();

      let deepest: CommentNode = {
        id: "lvl-7",
        description: "Seventh level reply",
        parentId: "lvl-6",
        createdAt: new Date().toISOString(),
        deletedAt: null,
        user: { username: "deep_thinker" },
        children: []
      };

      for (let i = 6; i >= 1; i--) {
        deepest = {
          id: `lvl-${i}`,
          description: `Level ${i} conversation`,
          parentId: i === 1 ? null : `lvl-${i - 1}`,
          createdAt: new Date().toISOString(),
          deletedAt: null,
          user: { username: `user_${i}` },
          children: [deepest]
        };
      }

      client.setQueryData(["comments", "iss-deep-7"], [deepest]);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-deep-7" orgId="org-1" />,
        client
      );

      for (let i = 1; i <= 7; i++) {
        expect(html).toContain(`data-testid="comment-lvl-${i}"`);
        expect(html).toContain(`data-testid="reply-comment-lvl-${i}"`);
      }
      expect(html).toContain("Seventh level reply");
    });
  });

  describe("4. Empirical Boundary Analysis: Card Metadata Badges & Edge Cases", () => {
    it("handles invalid/malformed due date strings gracefully without throwing", () => {
      expect(formatCardDate("invalid-iso-string")).toBe("invalid-iso-string");
      expect(formatCardDate("2026-13-45T99:99:99Z")).toBe("2026-13-45T99:99:99Z");

      const issueWithInvalidDate: BoardIssue = {
        id: "iss-inv-date",
        title: "Task with corrupted date string",
        position: 1000,
        priority: "low",
        dueDate: "corrupted-date-value",
        isArchived: false,
        boardId: "b-1",
        sectionId: "s-1"
      };

      // Renders safely without crashing React SSR
      const html = renderWithProviders(<KanbanCard issue={issueWithInvalidDate} />);
      expect(html).toContain("Task with corrupted date string");
      expect(html).toContain("corrupted-date-value");
      expect(html).not.toContain('data-testid="due-date-past-due"');
    });

    it("computes checklist completion across multiple checklists and handles empty checklists", () => {
      const issueWithChecklists: BoardIssue = {
        id: "iss-chk-multi",
        title: "Task with 2 checklists",
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "s-1",
        checklists: [
          {
            id: "chk-1",
            title: "Checklist 1",
            position: 1000,
            items: [
              { id: "i-1", title: "Item 1", isCompleted: true },
              { id: "i-2", title: "Item 2", isCompleted: false }
            ]
          },
          {
            id: "chk-2",
            title: "Checklist 2",
            position: 2000,
            items: [
              { id: "i-3", title: "Item 3", isCompleted: true },
              { id: "i-4", title: "Item 4", isCompleted: true },
              { id: "i-5", title: "Item 5", isCompleted: false }
            ]
          },
          {
            id: "chk-empty",
            title: "Empty Checklist",
            position: 3000,
            items: []
          }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issueWithChecklists} />);
      expect(html).toContain('data-testid="card-checklist-ratio"');
      // 3 completed out of 5 total items across all checklists
      expect(html).toContain("3/5");
    });

    it("renders emerald styling when 100% of checklist items are completed", () => {
      const completedIssue: BoardIssue = {
        id: "iss-completed",
        title: "All done",
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "s-1",
        checklists: [
          {
            id: "chk-done",
            title: "Done List",
            position: 1000,
            items: [
              { id: "i-1", title: "Done 1", isCompleted: true },
              { id: "i-2", title: "Done 2", isCompleted: true }
            ]
          }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={completedIssue} />);
      expect(html).toContain("2/2");
      expect(html).toContain("text-emerald-600");
    });

    it("handles assignee avatars overflow count correctly (+1 for 4, +7 for 10)", () => {
      const makeIssueWithAssignees = (count: number): BoardIssue => ({
        id: `iss-ass-${count}`,
        title: `Card with ${count} assignees`,
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "s-1",
        issueMappings: Array.from({ length: count }, (_, i) => ({
          user: {
            id: `u-${i}`,
            username: `user_${i}`,
            email: `user_${i}@test.com`,
            name: `User ${i}`,
            avatarUrl: null
          }
        }))
      });

      // 3 assignees -> no +N badge
      const html3 = renderWithProviders(<KanbanCard issue={makeIssueWithAssignees(3)} />);
      expect(html3).not.toContain("+");

      // 4 assignees -> +1 badge
      const html4 = renderWithProviders(<KanbanCard issue={makeIssueWithAssignees(4)} />);
      expect(html4).toContain("+1");

      // 10 assignees -> +7 badge
      const html10 = renderWithProviders(<KanbanCard issue={makeIssueWithAssignees(10)} />);
      expect(html10).toContain("+7");
    });
  });

  describe("5. Empirical Verification: REST Client Endpoints & Serialization", () => {
    const originalGet = api.get;
    const originalPost = api.post;
    const originalPatch = api.patch;
    const originalPut = api.put;
    const originalDelete = api.delete;

    afterEach(() => {
      api.get = originalGet;
      api.post = originalPost;
      api.patch = originalPatch;
      api.put = originalPut;
      api.delete = originalDelete;
    });

    it("verifies kanbanApi.createSection executes PATCH to update wipLimit if wipLimit is set", async () => {
      const mockCreated: BoardSection = {
        id: "sec-wip-persist",
        title: "Testing WIP Section",
        position: 1000,
        isArchived: false,
        wipLimit: null
      };

      const mockUpdated: BoardSection = {
        ...mockCreated,
        wipLimit: 5
      };

      let postCalled = false;
      let patchCalled = false;

      api.post = mock((url: string, payload: unknown) => {
        postCalled = true;
        expect(url).toBe("/api/boards/b-123/sections");
        expect(payload).toEqual({ title: "Testing WIP Section", position: 1000 });
        return Promise.resolve({ data: { success: true, data: mockCreated } });
      }) as unknown as typeof api.post;

      api.patch = mock((url: string, payload: unknown) => {
        patchCalled = true;
        expect(url).toBe("/api/sections/sec-wip-persist");
        expect(payload).toEqual({ wipLimit: 5 });
        return Promise.resolve({ data: { success: true, data: mockUpdated } });
      }) as unknown as typeof api.patch;

      const res = await kanbanApi.createSection("b-123", {
        title: "Testing WIP Section",
        position: 1000,
        wipLimit: 5
      });

      expect(postCalled).toBe(true);
      expect(patchCalled).toBe(true);
      expect(res.wipLimit).toBe(5);
    });

    it("verifies kanbanApi.deleteSection formats targetSectionId in both query params and body", async () => {
      let deleteCalled = false;
      api.delete = mock((url: string, config?: { params?: unknown; data?: unknown }) => {
        deleteCalled = true;
        expect(url).toBe("/api/sections/sec-to-delete");
        expect(config?.params).toEqual({ targetSectionId: "sec-target" });
        expect(config?.data).toEqual({ targetSectionId: "sec-target" });
        return Promise.resolve({ data: { success: true, data: "Section deleted" } });
      }) as unknown as typeof api.delete;

      const res = await kanbanApi.deleteSection("sec-to-delete", "sec-target");
      expect(deleteCalled).toBe(true);
      expect(res.success).toBe(true);
    });

    it("verifies kanbanApi.assignIssue and removeAssignment payload structures", async () => {
      let assignCalled = false;
      api.post = mock((url: string, body: unknown) => {
        assignCalled = true;
        expect(url).toBe("/api/issues/iss-1/assignees");
        expect(body).toEqual({ email: ["dev1@test.com", "dev2@test.com"] });
        return Promise.resolve({ data: { success: true, data: "Assigned" } });
      }) as unknown as typeof api.post;

      await kanbanApi.assignIssue("iss-1", ["dev1@test.com", "dev2@test.com"]);
      expect(assignCalled).toBe(true);

      let removeCalled = false;
      api.delete = mock((url: string, config?: { data?: unknown }) => {
        removeCalled = true;
        expect(url).toBe("/api/issues/iss-1/assignees/");
        expect(config?.data).toEqual({ email: "dev1@test.com" });
        return Promise.resolve({ data: { success: true, data: "Removed" } });
      }) as unknown as typeof api.delete;

      await kanbanApi.removeAssignment("iss-1", "dev1@test.com");
      expect(removeCalled).toBe(true);
    });
  });
});
