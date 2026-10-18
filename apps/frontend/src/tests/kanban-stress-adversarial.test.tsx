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
import { KanbanCanvas } from "../components/board/KanbanCanvas";
import { CardCommentsSection } from "../components/board/CardDetailModal/CardCommentsSection";
import { CardChecklistsSection } from "../components/board/CardDetailModal/CardChecklistsSection";
import { getKanbanErrorMessage, type CommentNode } from "../lib/kanban-api";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import type { BoardDetail, BoardIssue, BoardSection } from "../lib/board-api";
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

describe("Step 5 Adversarial Stress & Edge Cases Harness", () => {
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

  describe("1. Error Handler Extreme Inputs", () => {
    it("handles deeply nested non-standard rejection objects", () => {
      const err = {
        response: {
          data: {
            details: {
              raw: "Uncaught failure"
            }
          }
        }
      };
      expect(getKanbanErrorMessage(err, "Fallback")).toBe("Fallback");
    });

    it("handles primitives, symbols, arrays, and null prototype errors", () => {
      expect(getKanbanErrorMessage("String failure", "Fallback")).toBe("Fallback");
      expect(getKanbanErrorMessage(12345, "Fallback")).toBe("Fallback");
      expect(getKanbanErrorMessage(true, "Fallback")).toBe("Fallback");
      expect(getKanbanErrorMessage(Symbol("fail"), "Fallback")).toBe("Fallback");
      const nullProto = Object.create(null);
      nullProto.message = "Null proto error";
      expect(getKanbanErrorMessage(nullProto)).toBe("Null proto error");
    });
  });

  describe("2. WIP Limit Exact Boundaries", () => {
    it("does not trigger warning when issue count is exactly at the WIP limit", () => {
      const issues: BoardIssue[] = [
        { id: "i-1", title: "C1", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "i-2", title: "C2", position: 200, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "i-3", title: "C3", position: 300, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" }
      ];

      const section: BoardSection = {
        id: "s-1",
        title: "Exact Boundary",
        position: 1000,
        wipLimit: 3,
        isArchived: false,
        issues
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={section}
          boardId="b-1"
          orgId="org-1"
          allSections={[section]}
        />
      );

      expect(html).toContain("3 / 3");
      expect(html).not.toContain('data-testid="wip-limit-warning"');
    });

    it("immediately triggers warning when issue count exceeds WIP limit by 1", () => {
      const issues: BoardIssue[] = [
        { id: "i-1", title: "C1", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "i-2", title: "C2", position: 200, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "i-3", title: "C3", position: 300, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "i-4", title: "C4", position: 400, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" }
      ];

      const section: BoardSection = {
        id: "s-1",
        title: "Over Boundary",
        position: 1000,
        wipLimit: 3,
        isArchived: false,
        issues
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
      expect(html).toContain("4 / 3");
    });
  });

  describe("3. Comment 24-Hour Time Threshold Precision", () => {
    it("permits author edit at 23h 59m, but locks author edit at 24h 1m", () => {
      const client = createTestQueryClient();
      const now = Date.now();

      // Exactly 23 hours and 59 minutes ago (1,439 minutes)
      const date23h59m = new Date(now - (23 * 60 + 59) * 60 * 1000).toISOString();
      // Exactly 24 hours and 1 minute ago (1,441 minutes)
      const date24h01m = new Date(now - (24 * 60 + 1) * 60 * 1000).toISOString();

      const comments: CommentNode[] = [
        {
          id: "cmt-eligible",
          description: "Eligible for edit",
          parentId: null,
          createdAt: date23h59m,
          deletedAt: null,
          user: { id: "u-admin", username: "admin" },
          children: []
        },
        {
          id: "cmt-expired",
          description: "Expired edit window",
          parentId: null,
          createdAt: date24h01m,
          deletedAt: null,
          user: { id: "u-admin", username: "admin" },
          children: []
        }
      ];

      client.setQueryData(["comments", "iss-stress"], comments);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-stress" orgId="org-1" />,
        client
      );

      expect(html).toContain('data-testid="edit-comment-cmt-eligible"');
      expect(html).not.toContain('data-testid="edit-comment-cmt-expired"');
    });

    it("allows admin deletion of comments created days ago by other users", () => {
      const client = createTestQueryClient();
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      const comments: CommentNode[] = [
        {
          id: "cmt-ancient",
          description: "Ancient comment by ex-employee",
          parentId: null,
          createdAt: fiveDaysAgo,
          deletedAt: null,
          user: { id: "u-other", username: "ex_employee" },
          children: []
        }
      ];

      client.setQueryData(["comments", "iss-stress"], comments);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-stress" orgId="org-1" />,
        client
      );

      // Admin is not the author, but can delete anytime
      expect(html).toContain('data-testid="delete-comment-cmt-ancient"');
      expect(html).not.toContain('data-testid="edit-comment-cmt-ancient"');
    });
  });

  describe("4. Deeply Nested Comment Hierarchy (5 Levels)", () => {
    it("renders 5 levels of hierarchical nested replies cleanly", () => {
      const client = createTestQueryClient();

      const deepTree: CommentNode = {
        id: "lvl-1",
        description: "Level 1 Root",
        parentId: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        user: { username: "u1" },
        children: [
          {
            id: "lvl-2",
            description: "Level 2 Child",
            parentId: "lvl-1",
            createdAt: new Date().toISOString(),
            deletedAt: null,
            user: { username: "u2" },
            children: [
              {
                id: "lvl-3",
                description: "Level 3 Grandchild",
                parentId: "lvl-2",
                createdAt: new Date().toISOString(),
                deletedAt: null,
                user: { username: "u3" },
                children: [
                  {
                    id: "lvl-4",
                    description: "Level 4 Great-Grandchild",
                    parentId: "lvl-3",
                    createdAt: new Date().toISOString(),
                    deletedAt: null,
                    user: { username: "u4" },
                    children: [
                      {
                        id: "lvl-5",
                        description: "Level 5 Deepest Reply",
                        parentId: "lvl-4",
                        createdAt: new Date().toISOString(),
                        deletedAt: null,
                        user: { username: "u5" },
                        children: []
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      client.setQueryData(["comments", "iss-deep"], [deepTree]);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-deep" orgId="org-1" />,
        client
      );

      expect(html).toContain('data-testid="comment-lvl-1"');
      expect(html).toContain("Level 1 Root");
      expect(html).toContain('data-testid="comment-lvl-2"');
      expect(html).toContain("Level 2 Child");
      expect(html).toContain('data-testid="comment-lvl-3"');
      expect(html).toContain("Level 3 Grandchild");
      expect(html).toContain('data-testid="comment-lvl-4"');
      expect(html).toContain("Level 4 Great-Grandchild");
      expect(html).toContain('data-testid="comment-lvl-5"');
      expect(html).toContain("Level 5 Deepest Reply");
    });
  });

  describe("5. Extreme Payloads: Unicode, Emojis, 50 Checklist Items, 20 Labels", () => {
    it("renders card with emojis, unicode Japanese text, and 20 labels without failing", () => {
      const labels = Array.from({ length: 20 }, (_, i) => ({
        label: {
          id: `lbl-${i}`,
          name: `🏷️ Label ${i} 日本語`,
          color: i % 2 === 0 ? "#ef4444" : "#3b82f6"
        }
      }));

      const extremeIssue: BoardIssue = {
        id: "iss-extreme",
        title: "🚀 Urgent Rocket Launch: 日本語テスト ⚡ 100% Critical!",
        position: 1000,
        priority: "urgent",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        labels
      };

      const html = renderWithProviders(<KanbanCard issue={extremeIssue} />);
      expect(html).toContain("🚀 Urgent Rocket Launch: 日本語テスト ⚡ 100% Critical!");
      expect(html).toContain("urgent");
      expect(html).toContain("🏷️ Label 0 日本語");
      expect(html).toContain("🏷️ Label 19 日本語");
    });

    it("renders checklist with 50 subtask items and computes 100% completion", () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `chk-item-${i}`,
        content: `Subtask item #${i + 1}`,
        isCompleted: true,
        position: (i + 1) * 1000,
        checklistId: "chk-massive"
      }));

      const checklists = [
        {
          id: "chk-massive",
          title: "Massive 50-Item Checklist",
          position: 1000,
          issueId: "iss-massive",
          items
        }
      ];

      const html = renderWithProviders(
        <CardChecklistsSection
          boardId="b-1"
          issueId="iss-massive"
          checklists={checklists}
          canEdit={true}
        />
      );

      expect(html).toContain("Massive 50-Item Checklist");
      expect(html).toContain("100% (50/50)");
      expect(html).toContain("Subtask item #1");
      expect(html).toContain("Subtask item #50");
    });

    it("renders canvas with 10 columns and 50 total cards cleanly", () => {
      const mockBoard: BoardDetail = {
        id: "b-stress",
        title: "High Scale Board",
        description: "Stress testing canvas rendering",
        color: "#6366f1",
        isArchived: false,
        orgId: "org-1",
        section: Array.from({ length: 10 }, (_, s) => ({
          id: `sec-${s}`,
          title: `Column ${s}`,
          position: s * 1000,
          isArchived: false,
          issues: Array.from({ length: 5 }, (_, c) => ({
            id: `card-${s}-${c}`,
            title: `Issue ${s}-${c}`,
            position: c * 1000,
            priority: "medium",
            isArchived: false,
            boardId: "b-stress",
            sectionId: `sec-${s}`
          }))
        }))
      };

      const html = renderWithProviders(<KanbanCanvas board={mockBoard} />);
      expect(html).toContain('data-testid="column-sec-0"');
      expect(html).toContain('data-testid="column-sec-9"');
      expect(html).toContain('data-testid="card-card-0-0"');
      expect(html).toContain('data-testid="card-card-9-4"');
    });
  });
});
