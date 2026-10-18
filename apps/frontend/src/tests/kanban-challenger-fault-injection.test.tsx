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

import { KanbanCard, formatCardDate } from "../components/board/KanbanCard";
import { KanbanColumn } from "../components/board/KanbanColumn";
import { KanbanCanvas } from "../components/board/KanbanCanvas";
import { DeleteColumnModal } from "../components/board/DeleteColumnModal";
import { CardCommentsSection, formatCommentDate } from "../components/board/CardDetailModal/CardCommentsSection";
import { CardChecklistsSection } from "../components/board/CardDetailModal/CardChecklistsSection";
import { CardLabelsSection } from "../components/board/CardDetailModal/CardLabelsSection";
import { CardAssigneesSection } from "../components/board/CardDetailModal/CardAssigneesSection";
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

describe("Step 5 Challenger: Fault Injection & Adversarial Stress Suite", () => {
  const adminMembership: UserOrgMembership = {
    id: "mem-admin",
    role: "admin",
    accepted: true,
    userId: "u-admin",
    orgId: "org-challenger",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: {
      id: "org-challenger",
      name: "Challenger Org",
      description: "Adversarial Test Lab",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

  const contributorMembership: UserOrgMembership = {
    id: "mem-contributor",
    role: "contributor",
    accepted: true,
    userId: "u-contrib",
    orgId: "org-challenger",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: adminMembership.org
  };

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    useOrgStore.getState().resetOrgState();
    useOrgStore.setState({
      memberships: [adminMembership],
      activeOrgId: "org-challenger"
    });
    useAuthStore.setState({
      token: "challenger-mock-token",
      user: {
        id: "u-admin",
        email: "admin@challenger.test",
        username: "admin_challenger"
      }
    });
  });

  describe("1. Fault Injection & Error Resilience in getKanbanErrorMessage", () => {
    it("extracts exact error message across 400, 403, 404, 409, 500 status codes", () => {
      const err400 = { response: { status: 400, data: { error: "Validation failed: Section title is required" } } };
      expect(getKanbanErrorMessage(err400)).toBe("Validation failed: Section title is required");

      const err403 = { response: { status: 403, data: { message: "Only organization admins can delete columns" } } };
      expect(getKanbanErrorMessage(err403)).toBe("Only organization admins can delete columns");

      const err404 = { response: { status: 404, data: { error: "Card not found" } } };
      expect(getKanbanErrorMessage(err404)).toBe("Card not found");

      const err409 = { response: { status: 409, data: { message: "Target section cannot be the same as deleted section" } } };
      expect(getKanbanErrorMessage(err409)).toBe("Target section cannot be the same as deleted section");

      const err500 = { response: { status: 500, data: { error: "Internal database deadlock" } } };
      expect(getKanbanErrorMessage(err500)).toBe("Internal database deadlock");
    });

    it("handles Network Errors, Offline States, and Timeout Aborts cleanly", () => {
      const netError = new TypeError("Failed to fetch");
      expect(getKanbanErrorMessage(netError)).toBe("Failed to fetch");

      const timeoutError = new Error("timeout of 10000ms exceeded");
      (timeoutError as unknown as { code: string }).code = "ECONNABORTED";
      expect(getKanbanErrorMessage(timeoutError)).toBe("timeout of 10000ms exceeded");

      const econnRefused = new Error("connect ECONNREFUSED 127.0.0.1:3000");
      expect(getKanbanErrorMessage(econnRefused)).toBe("connect ECONNREFUSED 127.0.0.1:3000");
    });

    it("handles corrupted, circular, and pathological rejection payloads safely", () => {
      // Circular reference object with response.data.error
      const circular: Record<string, unknown> = {
        response: {
          data: {
            error: "Circular server error"
          }
        }
      };
      circular.self = circular;
      expect(getKanbanErrorMessage(circular)).toBe("Circular server error");

      // Circular error with message property
      const circularMsg: Record<string, unknown> = { message: "Circular client error" };
      circularMsg.self = circularMsg;
      expect(getKanbanErrorMessage(circularMsg)).toBe("Circular client error");

      // Empty response or data
      expect(getKanbanErrorMessage({ response: {} }, "Custom Fallback")).toBe("Custom Fallback");
      expect(getKanbanErrorMessage({ response: { data: {} } }, "Custom Fallback")).toBe("Custom Fallback");
      expect(getKanbanErrorMessage({ response: { data: { error: "" } } }, "Custom Fallback")).toBe("Custom Fallback");
      expect(getKanbanErrorMessage({ response: { data: { error: null } } }, "Custom Fallback")).toBe("Custom Fallback");

      // Non-object primitives
      expect(getKanbanErrorMessage(null, "Null Fallback")).toBe("Null Fallback");
      expect(getKanbanErrorMessage(undefined, "Undef Fallback")).toBe("Undef Fallback");
      expect(getKanbanErrorMessage(NaN, "NaN Fallback")).toBe("NaN Fallback");
      expect(getKanbanErrorMessage(BigInt(9007199254740991), "BigInt Fallback")).toBe("BigInt Fallback");
      expect(getKanbanErrorMessage(() => "func", "Function Fallback")).toBe("Function Fallback");
    });
  });

  describe("2. Deep Hierarchical Discussions & Adversarial Input Stress", () => {
    it("renders 7 levels of deeply nested comment replies without stack overflow or truncated nodes", () => {
      const client = createTestQueryClient();

      const makeNode = (depth: number, maxDepth: number): CommentNode => ({
        id: `lvl-${depth}`,
        description: `Comment Level ${depth} Hierarchy Node`,
        parentId: depth === 1 ? null : `lvl-${depth - 1}`,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        user: { username: `user_l${depth}` },
        children: depth < maxDepth ? [makeNode(depth + 1, maxDepth)] : []
      });

      const rootNode = makeNode(1, 7);
      client.setQueryData(["comments", "iss-deep-7"], [rootNode]);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-deep-7" orgId="org-challenger" />,
        client
      );

      for (let lvl = 1; lvl <= 7; lvl++) {
        expect(html).toContain(`data-testid="comment-lvl-${lvl}"`);
        expect(html).toContain(`Comment Level ${lvl} Hierarchy Node`);
        expect(html).toContain(`user_l${lvl}`);
      }
    });

    it("safely handles XSS injections, RTL Arabic, and Unicode emojis in comment description", () => {
      const client = createTestQueryClient();
      const injectionComment: CommentNode = {
        id: "cmt-xss-unicode",
        description: '<script>alert("xss")</script> 🚀 🔥 日本語テキスト العربية مرحبا',
        parentId: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        user: { username: "adversary" },
        children: []
      };

      client.setQueryData(["comments", "iss-xss"], [injectionComment]);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-xss" orgId="org-challenger" />,
        client
      );

      // React escapes HTML tags by default
      expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
      expect(html).toContain("🚀 🔥 日本語テキスト العربية مرحبا");
    });

    it("evaluates comment date formatting resilience on corrupted and edge date inputs", () => {
      expect(formatCommentDate("invalid-iso-date")).toBe("invalid-iso-date");
      expect(formatCommentDate("")).toBe("");
      expect(formatCommentDate("1970-01-01T00:00:00Z")).toContain("Jan 1");
    });

    it("strictly blocks non-author non-admin from editing or deleting comments", () => {
      useOrgStore.setState({
        memberships: [contributorMembership],
        activeOrgId: "org-challenger"
      });
      useAuthStore.setState({
        user: { id: "u-contrib", username: "contributor_user", email: "contrib@test.com" }
      });

      const client = createTestQueryClient();
      const otherUserComment: CommentNode = {
        id: "cmt-other",
        description: "Comment authored by another user 1 hour ago",
        parentId: null,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        deletedAt: null,
        user: { id: "u-author", username: "author_user" },
        children: []
      };

      client.setQueryData(["comments", "iss-rbac"], [otherUserComment]);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-rbac" orgId="org-challenger" />,
        client
      );

      expect(html).toContain("Comment authored by another user 1 hour ago");
      expect(html).not.toContain('data-testid="edit-comment-cmt-other"');
      expect(html).not.toContain('data-testid="delete-comment-cmt-other"');
    });
  });

  describe("3. Scaling & Layout Ordering Invariants: 15 Columns & 75 Cards", () => {
    it("renders 15 columns sorted strictly by ascending position even when input is scrambled", () => {
      const scrambledPositions = [1500, 300, 900, -200, 450, 0, 100, 2000, 800, 1200, 600, 700, 2500, -50, 1800];
      const sortedExpected = [...scrambledPositions].sort((a, b) => a - b);

      const sections: BoardSection[] = scrambledPositions.map((pos, idx) => ({
        id: `sec-${idx}`,
        title: `Col_Pos_${pos}`,
        position: pos,
        isArchived: false,
        issues: Array.from({ length: 5 }, (_, cIdx) => ({
          id: `iss-${idx}-${cIdx}`,
          title: `Card ${idx}-${cIdx}`,
          position: (5 - cIdx) * 100, // Reversed card positions
          priority: "medium",
          isArchived: false,
          boardId: "board-scale",
          sectionId: `sec-${idx}`
        }))
      }));

      const board: BoardDetail = {
        id: "board-scale",
        title: "Scale Test Board",
        description: "15 columns x 5 cards",
        color: "#3b82f6",
        isArchived: false,
        orgId: "org-challenger",
        section: sections
      };

      const html = renderWithProviders(<KanbanCanvas board={board} />);

      // Verify all 15 columns render
      for (let idx = 0; idx < 15; idx++) {
        expect(html).toContain(`data-testid="column-sec-${idx}"`);
      }

      // Verify column titles appear in sorted order in the rendered HTML stream
      let lastIndex = -1;
      for (const pos of sortedExpected) {
        const titleStr = `Col_Pos_${pos}`;
        const currentIndex = html.indexOf(titleStr);
        expect(currentIndex).toBeGreaterThan(lastIndex);
        lastIndex = currentIndex;
      }
    });

    it("verifies card position sorting invariant inside KanbanColumn", () => {
      const unsortedIssues: BoardIssue[] = [
        { id: "c-300", title: "Card 300", position: 300, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "c-10", title: "Card 10", position: 10, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "c-neg", title: "Card Neg", position: -50, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" },
        { id: "c-100", title: "Card 100", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "s-1" }
      ];

      const section: BoardSection = {
        id: "s-1",
        title: "Sort Column",
        position: 1000,
        isArchived: false,
        issues: unsortedIssues
      };

      const html = renderWithProviders(
        <KanbanColumn
          section={section}
          boardId="b-1"
          orgId="org-challenger"
          allSections={[section]}
        />
      );

      const idxNeg = html.indexOf("Card Neg");
      const idx10 = html.indexOf("Card 10");
      const idx100 = html.indexOf("Card 100");
      const idx300 = html.indexOf("Card 300");

      expect(idxNeg).toBeLessThan(idx10);
      expect(idx10).toBeLessThan(idx100);
      expect(idx100).toBeLessThan(idx300);
    });
  });

  describe("4. WIP Limit Math & Edge Boundaries", () => {
    it("handles WIP limit of 0: 0 cards is clean, 1 card triggers warning", () => {
      const emptySection: BoardSection = {
        id: "sec-zero",
        title: "Zero Limit Empty",
        position: 1000,
        wipLimit: 0,
        isArchived: false,
        issues: []
      };

      const emptyHtml = renderWithProviders(
        <KanbanColumn section={emptySection} boardId="b-1" orgId="org-challenger" allSections={[emptySection]} />
      );
      expect(emptyHtml).toContain("0 / 0");
      expect(emptyHtml).not.toContain('data-testid="wip-limit-warning"');

      const oneCardSection: BoardSection = {
        ...emptySection,
        issues: [{ id: "c-1", title: "Card", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-zero" }]
      };

      const oneHtml = renderWithProviders(
        <KanbanColumn section={oneCardSection} boardId="b-1" orgId="org-challenger" allSections={[oneCardSection]} />
      );
      expect(oneHtml).toContain('data-testid="wip-limit-warning"');
      expect(oneHtml).toContain("1 / 0");
    });

    it("handles large WIP limits without integer overflow or display glitches", () => {
      const highLimitSection: BoardSection = {
        id: "sec-high",
        title: "High Limit Column",
        position: 1000,
        wipLimit: 1000000,
        isArchived: false,
        issues: Array.from({ length: 10 }, (_, i) => ({
          id: `c-${i}`,
          title: `Card ${i}`,
          position: i * 100,
          priority: "low",
          isArchived: false,
          boardId: "b-1",
          sectionId: "sec-high"
        }))
      };

      const html = renderWithProviders(
        <KanbanColumn section={highLimitSection} boardId="b-1" orgId="org-challenger" allSections={[highLimitSection]} />
      );

      expect(html).toContain("10 / 1000000");
      expect(html).not.toContain('data-testid="wip-limit-warning"');
    });
  });

  describe("5. Column Deletion Guardrails & Reassignment Isolation", () => {
    it("strictly disables column deletion when sole non-empty column exists", () => {
      const soleSection: BoardSection = {
        id: "sec-sole",
        title: "Sole Non-Empty Column",
        position: 1000,
        isArchived: false,
        issues: [{ id: "c-1", title: "C1", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-sole" }]
      };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-challenger"
          section={soleSection}
          allSections={[soleSection]}
        />
      );

      expect(html).toContain("Cannot delete the only column containing cards. Please delete or move cards first.");
      expect(html).toContain("disabled");
    });

    it("renders reassign issues modal and excludes deleted section from target options", () => {
      const sectionToDelete: BoardSection = {
        id: "sec-del",
        title: "To Be Deleted",
        position: 1000,
        isArchived: false,
        issues: [{ id: "c-1", title: "C1", position: 100, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-del" }]
      };

      const targetA: BoardSection = { id: "sec-a", title: "Column Alpha", position: 2000, isArchived: false, issues: [] };
      const targetB: BoardSection = { id: "sec-b", title: "Column Beta", position: 3000, isArchived: false, issues: [] };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-challenger"
          section={sectionToDelete}
          allSections={[sectionToDelete, targetA, targetB]}
        />
      );

      expect(html).toContain('data-testid="reassign-issues-modal"');
      expect(html).toContain('data-testid="target-section-select"');
      expect(html).toContain("Column Alpha");
      expect(html).toContain("Column Beta");
      // Target options should NOT allow reassigning to self
      expect(html).not.toContain('<option value="sec-del"');
    });

    it("strictly prevents contributor or employee from deleting any column", () => {
      useOrgStore.setState({
        memberships: [contributorMembership],
        activeOrgId: "org-challenger"
      });

      const emptySection: BoardSection = {
        id: "sec-empty",
        title: "Empty Column",
        position: 1000,
        isArchived: false,
        issues: []
      };

      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-challenger"
          section={emptySection}
          allSections={[emptySection]}
        />
      );

      expect(html).toContain("Only organization admins can delete columns.");
      expect(html).toContain("disabled");
    });
  });

  describe("6. Card Metadata Badges & Card Detail Modal Facets", () => {
    it("handles zero items in checklist without division by zero NaN error", () => {
      const checklists = [
        {
          id: "chk-empty",
          title: "Empty Checklist",
          position: 1000,
          issueId: "iss-1",
          items: []
        }
      ];

      const html = renderWithProviders(
        <CardChecklistsSection
          boardId="b-1"
          issueId="iss-1"
          checklists={checklists}
          canEdit={true}
        />
      );

      expect(html).toContain("0% (0/0)");
      expect(html).not.toContain("NaN");
    });

    it("handles corrupted date strings in formatCardDate safely", () => {
      expect(formatCardDate("corrupted-date")).toBe("corrupted-date");
      expect(formatCardDate("")).toBe("");
    });

    it("renders label chips with custom hex and rgb colors", () => {
      const issueWithLabels: BoardIssue = {
        id: "iss-lbl",
        title: "Labeled Card",
        position: 100,
        priority: "urgent",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1",
        labels: [
          { label: { id: "l-1", name: "Bug", color: "#e11d48" } },
          { label: { id: "l-2", name: "Backend", color: "rgb(59, 130, 246)" } }
        ]
      };

      const html = renderWithProviders(<KanbanCard issue={issueWithLabels} />);
      expect(html).toContain('data-testid="card-label-l-1"');
      expect(html).toContain("Bug");
      expect(html).toContain('data-testid="card-label-l-2"');
      expect(html).toContain("Backend");
    });

    it("renders CardLabelsSection and CardAssigneesSection cleanly under empty sets", () => {
      const labelsHtml = renderWithProviders(
        <CardLabelsSection
          boardId="b-1"
          issueId="iss-1"
          attachedLabels={[]}
          canEdit={true}
        />
      );
      expect(labelsHtml).toContain("Labels");
      expect(labelsHtml).toContain("No labels attached");

      const assigneesHtml = renderWithProviders(
        <CardAssigneesSection
          boardId="b-1"
          orgId="org-challenger"
          issueId="iss-1"
          assignedMappings={[]}
          canEdit={true}
        />
      );
      expect(assigneesHtml).toContain("Assignees");
      expect(assigneesHtml).toContain("No members assigned");
    });
  });
});
