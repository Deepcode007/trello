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

import { CardDetailModal } from "../components/board/CardDetailModal/CardDetailModal";
import { CardLabelsSection } from "../components/board/CardDetailModal/CardLabelsSection";
import { CardAssigneesSection } from "../components/board/CardDetailModal/CardAssigneesSection";
import { CardChecklistsSection } from "../components/board/CardDetailModal/CardChecklistsSection";
import { CardCommentsSection } from "../components/board/CardDetailModal/CardCommentsSection";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import type { BoardSection } from "../lib/board-api";
import type { UserOrgMembership } from "../lib/org-api";
import type { IssueDetail, CommentNode } from "../lib/kanban-api";

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

describe("R3: Card Detail Modal & Multi-Facet Entity Interactions", () => {
  const adminMembership: UserOrgMembership = {
    id: "mem-admin",
    role: "admin",
    accepted: true,
    userId: "u-alice",
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

  const sections: BoardSection[] = [
    { id: "sec-1", title: "To Do", position: 1000, isArchived: false },
    { id: "sec-2", title: "In Progress", position: 2000, isArchived: false },
    { id: "sec-3", title: "Done", position: 3000, isArchived: false }
  ];

  const mockDetail: IssueDetail = {
    id: "iss-1",
    title: "Implement OAuth2 login with GitHub",
    description: "Detailed specification for GitHub OAuth integration.",
    position: 1000,
    priority: "high",
    startDate: "2026-10-20T00:00:00Z",
    dueDate: "2026-10-25T00:00:00Z",
    gh_url: "https://github.com/org/repo/issues/42",
    isArchived: false,
    boardId: "b-1",
    sectionId: "sec-2",
    board: { id: "b-1", title: "Sprint Alpha" },
    section: { id: "sec-2", title: "In Progress" },
    labels: [
      {
        id: "map-1",
        issueId: "iss-1",
        labelId: "lbl-auth",
        label: { id: "lbl-auth", name: "Security", color: "#ef4444" }
      }
    ],
    issueMappings: [
      {
        id: "map-2",
        userId: "u-alice",
        issueId: "iss-1",
        user: {
          id: "u-alice",
          username: "alice",
          email: "alice@test.com",
          name: "Alice Smith",
          avatarUrl: null
        }
      }
    ],
    checklists: [
      {
        id: "chk-1",
        title: "Testing Checklist",
        position: 1000,
        issueId: "iss-1",
        items: [
          {
            id: "chk-item-1",
            content: "Unit tests pass",
            isCompleted: true,
            position: 1000,
            checklistId: "chk-1"
          },
          {
            id: "chk-item-2",
            content: "Integration with backend",
            isCompleted: false,
            position: 2000,
            checklistId: "chk-1"
          }
        ]
      }
    ]
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
        id: "u-alice",
        email: "alice@test.com",
        username: "alice",
        name: "Alice Smith"
      }
    });
  });

  describe("Modal Mount & Core Attributes", () => {
    it("renders modal shell with all card attributes prefilled", () => {
      const client = createTestQueryClient();
      client.setQueryData(["issue", "iss-1"], mockDetail);

      const html = renderWithProviders(
        <CardDetailModal
          issueId="iss-1"
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          allSections={sections}
        />,
        client
      );

      expect(html).toContain('data-testid="card-detail-modal"');
      expect(html).toContain('data-testid="card-detail-title-input"');
      expect(html).toContain('value="Implement OAuth2 login with GitHub"');
      expect(html).toContain('data-testid="card-detail-description-input"');
      expect(html).toContain("Detailed specification for GitHub OAuth integration.");
      expect(html).toContain('data-testid="priority-select"');
      expect(html).toContain('value="high"');
      expect(html).toContain('data-testid="move-column-select"');
      expect(html).toContain("In Progress");
      expect(html).toContain('data-testid="start-date-input"');
      expect(html).toContain('data-testid="due-date-input"');
      expect(html).toContain('data-testid="gh-url-input"');
      expect(html).toContain('value="https://github.com/org/repo/issues/42"');
      expect(html).toContain('data-testid="delete-card-button"');
    });
  });

  describe("Labels Facet", () => {
    it("renders attached labels with detach button", () => {
      const client = createTestQueryClient();
      client.setQueryData(["labels", "b-1"], [
        { id: "lbl-auth", name: "Security", color: "#ef4444" },
        { id: "lbl-perf", name: "Performance", color: "#3b82f6" }
      ]);

      const html = renderWithProviders(
        <CardLabelsSection
          boardId="b-1"
          issueId="iss-1"
          attachedLabels={mockDetail.labels}
          canEdit={true}
        />,
        client
      );

      expect(html).toContain("Security");
      expect(html).toContain('data-testid="detach-label-lbl-auth"');
      expect(html).toContain('data-testid="add-label-trigger"');
    });
  });

  describe("Assignees Facet", () => {
    it("renders assigned members with remove button and assign trigger", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-1"], [
        { accepted: true, user: { username: "alice", email: "alice@test.com" } },
        { accepted: true, user: { username: "bob", email: "bob@test.com" } }
      ]);

      const html = renderWithProviders(
        <CardAssigneesSection
          boardId="b-1"
          orgId="org-1"
          issueId="iss-1"
          assignedMappings={mockDetail.issueMappings}
          canEdit={true}
        />,
        client
      );

      expect(html).toContain("Alice Smith");
      expect(html).toContain('data-testid="remove-assignee-alice@test.com"');
      expect(html).toContain('data-testid="assign-member-trigger"');
    });

    it("resolves and displays real names from orgMembers for assigned users and member picker", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-1"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-1",
          userId: "u-2",
          user: {
            id: "u-2",
            name: "Robert Bob Jones",
            username: "bob",
            email: "bob@test.com"
          }
        }
      ]);

      const html = renderWithProviders(
        <CardAssigneesSection
          boardId="b-1"
          orgId="org-1"
          issueId="iss-1"
          assignedMappings={[
            {
              id: "m-2",
              userId: "u-2",
              issueId: "iss-1",
              user: {
                id: "u-2",
                username: "bob",
                email: "bob@test.com",
                name: "",
                avatarUrl: null
              }
            }
          ]}
          canEdit={true}
        />,
        client
      );

      // Assigned chip displays resolved real name from orgMembers
      expect(html).toContain("Robert Bob Jones");
      expect(html).toContain('title="Robert Bob Jones"');
    });
  });

  describe("Checklists Facet", () => {
    it("renders checklists with progress, items checkbox toggle, and delete button", () => {
      const html = renderWithProviders(
        <CardChecklistsSection
          boardId="b-1"
          issueId="iss-1"
          checklists={mockDetail.checklists}
          canEdit={true}
        />
      );

      expect(html).toContain("Testing Checklist");
      expect(html).toContain('data-testid="checklist-progress-chk-1"');
      expect(html).toContain("50% (1/2)");
      expect(html).toContain('data-testid="checklist-item-checkbox-chk-item-1"');
      expect(html).toContain('data-testid="checklist-item-checkbox-chk-item-2"');
      expect(html).toContain('data-testid="delete-checklist-chk-1"');
      expect(html).toContain('data-testid="add-item-trigger-chk-1"');
      expect(html).toContain('data-testid="add-checklist-trigger"');
    });
  });

  describe("Threaded Comments Facet & 24-Hour Permission Rules", () => {
    it("renders root input, comment tree with replies, and enforces 24-hour edit window", () => {
      const client = createTestQueryClient();

      const now = Date.now();
      const recentDate = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago (within 24h)
      const oldDate = new Date(now - 30 * 60 * 60 * 1000).toISOString(); // 30 hours ago (>24h)

      const commentsTree: CommentNode[] = [
        {
          id: "cmt-recent-mine",
          description: "Recent comment by current user",
          parentId: null,
          createdAt: recentDate,
          deletedAt: null,
          user: { id: "u-alice", username: "alice" },
          children: [
            {
              id: "cmt-reply-bob",
              description: "Nested reply by another user",
              parentId: "cmt-recent-mine",
              createdAt: recentDate,
              deletedAt: null,
              user: { id: "u-bob", username: "bob" },
              children: []
            }
          ]
        },
        {
          id: "cmt-old-mine",
          description: "Old comment created 30 hours ago",
          parentId: null,
          createdAt: oldDate,
          deletedAt: null,
          user: { id: "u-alice", username: "alice" },
          children: []
        }
      ];

      client.setQueryData(["comments", "iss-1"], commentsTree);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-1" orgId="org-1" />,
        client
      );

      expect(html).toContain('data-testid="new-comment-input"');
      expect(html).toContain('data-testid="post-comment-button"');

      // Check recent comment by Alice (editable + deletable)
      expect(html).toContain('data-testid="comment-cmt-recent-mine"');
      expect(html).toContain("Recent comment by current user");
      expect(html).toContain('data-testid="edit-comment-cmt-recent-mine"');
      expect(html).toContain('data-testid="delete-comment-cmt-recent-mine"');
      expect(html).toContain('data-testid="reply-comment-cmt-recent-mine"');

      // Check nested reply by Bob
      expect(html).toContain('data-testid="comment-cmt-reply-bob"');
      expect(html).toContain("Nested reply by another user");
      // Alice is NOT author of Bob's comment -> cannot edit
      expect(html).not.toContain('data-testid="edit-comment-cmt-reply-bob"');
      // But Alice is admin -> CAN delete Bob's comment
      expect(html).toContain('data-testid="delete-comment-cmt-reply-bob"');

      // Check old comment by Alice (>24h old):
      expect(html).toContain('data-testid="comment-cmt-old-mine"');
      expect(html).toContain("Old comment created 30 hours ago");
      // Cannot edit (>24h old)!
      expect(html).not.toContain('data-testid="edit-comment-cmt-old-mine"');
      // But can delete because admin!
      expect(html).toContain('data-testid="delete-comment-cmt-old-mine"');
    });

    it("prevents non-admin contributor from deleting comments older than 24h", () => {
      const contributorMembership: UserOrgMembership = {
        ...adminMembership,
        id: "mem-contrib",
        role: "contributor"
      };

      useOrgStore.setState({
        memberships: [contributorMembership],
        activeOrgId: "org-1"
      });

      const client = createTestQueryClient();
      const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();

      const commentsTree: CommentNode[] = [
        {
          id: "cmt-old-contrib",
          description: "Contributor old comment",
          parentId: null,
          createdAt: oldDate,
          deletedAt: null,
          user: { id: "u-alice", username: "alice" },
          children: []
        }
      ];

      client.setQueryData(["comments", "iss-1"], commentsTree);

      const html = renderWithProviders(
        <CardCommentsSection issueId="iss-1" orgId="org-1" />,
        client
      );

      // Cannot edit and cannot delete because contributor and >24h!
      expect(html).not.toContain('data-testid="edit-comment-cmt-old-contrib"');
      expect(html).not.toContain('data-testid="delete-comment-cmt-old-contrib"');
    });
  });
});
