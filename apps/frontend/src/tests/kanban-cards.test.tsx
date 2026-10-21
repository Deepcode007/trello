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

import { KanbanCard } from "../components/board/KanbanCard";
import { KanbanColumn } from "../components/board/KanbanColumn";
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

describe("R2: Issue Cards Canvas Rendering & Fast Creation", () => {
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

  describe("Card Metadata Badges Rendering", () => {
    it("renders card title and priority badges for all priority levels", () => {
      const priorities: Array<"low" | "medium" | "high" | "urgent"> = [
        "low",
        "medium",
        "high",
        "urgent"
      ];

      for (const prio of priorities) {
        const issue: BoardIssue = {
          id: `card-${prio}`,
          title: `Task with ${prio} priority`,
          position: 1000,
          priority: prio,
          isArchived: false,
          boardId: "b-1",
          sectionId: "sec-1"
        };

        const html = renderWithProviders(<KanbanCard issue={issue} />);
        expect(html).toContain(`data-testid="card-card-${prio}"`);
        expect(html).toContain(`Task with ${prio} priority`);
        expect(html).toContain('data-testid="card-priority-badge"');
        expect(html).toContain(prio);
      }
    });

    it("renders future due date normally without past-due indicator", () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const issue: BoardIssue = {
        id: "card-future",
        title: "Future task",
        position: 1000,
        priority: "medium",
        dueDate: futureDate,
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1"
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).not.toContain('data-testid="due-date-past-due"');
    });

    it("renders red past-due indicator with data-testid='due-date-past-due' when dueDate is in the past", () => {
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const issue: BoardIssue = {
        id: "card-past",
        title: "Overdue task",
        position: 1000,
        priority: "high",
        dueDate: pastDate,
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1"
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).toContain('data-testid="due-date-past-due"');
      expect(html).toContain("text-destructive");
    });

    it("renders checklist completion ratio accurately", () => {
      const issue: BoardIssue = {
        id: "card-chk",
        title: "Task with checklist",
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        checklists: [
          {
            id: "chk-1",
            title: "Checklist 1",
            position: 1000,
            items: [
              { id: "i-1", isCompleted: true },
              { id: "i-2", isCompleted: false },
              { id: "i-3", isCompleted: true }
            ]
          },
          {
            id: "chk-2",
            title: "Checklist 2",
            position: 2000,
            items: [
              { id: "i-4", isCompleted: false },
              { id: "i-5", isCompleted: false }
            ]
          }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).toContain('data-testid="card-checklist-ratio"');
      expect(html).toContain("2/5");
    });

    it("renders colored label chips with label names and style colors", () => {
      const issue: BoardIssue = {
        id: "card-labels",
        title: "Task with labels",
        position: 1000,
        priority: "low",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        labels: [
          {
            label: {
              id: "lbl-bug",
              name: "Bug",
              color: "#ef4444"
            }
          },
          {
            label: {
              id: "lbl-ui",
              name: "Frontend",
              color: "#3b82f6"
            }
          }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).toContain('data-testid="card-label-lbl-bug"');
      expect(html).toContain("Bug");
      expect(html).toContain("background-color:#ef4444");
      expect(html).toContain('data-testid="card-label-lbl-ui"');
      expect(html).toContain("Frontend");
      expect(html).toContain("background-color:#3b82f6");
    });

    it("renders assignee avatar stack with overflow badge when > 3 assignees", () => {
      const issue: BoardIssue = {
        id: "card-assignees",
        title: "Collaborative Task",
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        issueMappings: [
          { user: { id: "u-1", username: "alice", email: "alice@test.com", name: "Alice", avatarUrl: null } },
          { user: { id: "u-2", username: "bob", email: "bob@test.com", name: "Bob", avatarUrl: null } },
          { user: { id: "u-3", username: "charlie", email: "charlie@test.com", name: "Charlie", avatarUrl: null } },
          { user: { id: "u-4", username: "david", email: "david@test.com", name: "David", avatarUrl: null } },
          { user: { id: "u-5", username: "eve", email: "eve@test.com", name: "Eve", avatarUrl: null } }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      // First 3 should render
      expect(html).toContain("Alice");
      expect(html).toContain("Bob");
      expect(html).toContain("Charlie");
      // Overflow badge (+2)
      expect(html).toContain("+2");
    });

    it("renders assignee real name on card avatars and in title hover attribute", () => {
      const issue: BoardIssue = {
        id: "card-assignee-realnames",
        title: "Feature with real names",
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        issueMappings: [
          { user: { id: "u-1", username: "bob_dev", email: "bob@test.com", name: "Robert Jones", avatarUrl: null } },
          { user: { id: "u-2", username: "carol_c", email: "carol@test.com", name: "Carol Danvers", avatarUrl: null } }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).toContain('title="Robert Jones"');
      expect(html).toContain('title="Carol Danvers"');
    });

    it("resolves assignee real name from orgMembers in query client when card user.name is empty", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-dnd-123"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-dnd-123",
          userId: "u-3",
          user: {
            id: "u-3",
            name: "Eleanor Shellstrop",
            username: "eleanor_s",
            email: "eleanor@goodplace.test"
          }
        }
      ]);
      useOrgStore.setState({ activeOrgId: "org-dnd-123" });

      const issue: BoardIssue = {
        id: "card-resolve-orgmembers",
        title: "Resolve from org members cache",
        position: 1000,
        priority: "medium",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        issueMappings: [
          { user: { id: "u-3", username: "eleanor_s", email: "eleanor@goodplace.test", name: "", avatarUrl: null } }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />, client);
      expect(html).toContain('title="Eleanor Shellstrop"');
    });
  });

  describe("Column Card Ordering & Quick Card Creation", () => {
    it("renders cards sorted by ascending position within column", () => {
      const section: BoardSection = {
        id: "sec-ordered",
        title: "Sprint Tasks",
        position: 1000,
        isArchived: false,
        issues: [
          {
            id: "card-pos-300",
            title: "Third card",
            position: 300,
            priority: "low",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-ordered"
          },
          {
            id: "card-pos-100",
            title: "First card",
            position: 100,
            priority: "high",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-ordered"
          },
          {
            id: "card-pos-200",
            title: "Second card",
            position: 200,
            priority: "medium",
            isArchived: false,
            boardId: "b-1",
            sectionId: "sec-ordered"
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

      const idx1 = html.indexOf('data-testid="card-card-pos-100"');
      const idx2 = html.indexOf('data-testid="card-card-pos-200"');
      const idx3 = html.indexOf('data-testid="card-card-pos-300"');

      expect(idx1 < idx2).toBe(true);
      expect(idx2 < idx3).toBe(true);
    });

    it("renders Add a card quick creation trigger at column bottom", () => {
      const section: BoardSection = {
        id: "sec-empty-add",
        title: "To Do",
        position: 1000,
        isArchived: false,
        issues: []
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={section}
          boardId="b-1"
          orgId="org-1"
          allSections={[section]}
        />
      );

      expect(html).toContain('data-testid="add-card-button-sec-empty-add"');
      expect(html).toContain("Add a card");
    });
  });
});
