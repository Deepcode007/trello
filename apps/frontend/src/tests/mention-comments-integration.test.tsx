import { describe, it, expect, beforeEach } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardCommentsSection } from "../components/board/CardDetailModal/CardCommentsSection";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import type { CommentNode } from "../lib/kanban-api";
import type { UserOrgMembership } from "../lib/org-api";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 }
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

describe("Phase 6: CardCommentsSection & Mentions Integration Suite", () => {
  const currentUserId = "00000000-0000-4000-8000-000000000000";
  const mentionedUserId = "11111111-1111-4111-8111-111111111111";
  const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const issueId = "iss-mentions-1";

  const adminMembership: UserOrgMembership = {
    id: "mem-admin",
    role: "admin",
    accepted: true,
    userId: currentUserId,
    orgId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    org: {
      id: orgId,
      name: "Engineering Org",
      description: "Dev team",
      visible: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    useAuthStore.setState({
      user: {
        id: currentUserId,
        email: "author@example.com",
        username: "author",
        name: "Author User"
      },
      token: "mock-jwt"
    });

    useOrgStore.setState({
      memberships: [adminMembership],
      activeOrgId: orgId
    });
  });

  it("1. renders MentionInput with data-testid='new-comment-input' for root comment creation", () => {
    const client = createTestQueryClient();
    client.setQueryData(["comments", issueId], []);

    const html = renderWithProviders(
      <CardCommentsSection issueId={issueId} orgId={orgId} />,
      client
    );

    expect(html).toContain('data-testid="new-comment-input"');
    expect(html).toContain('data-testid="post-comment-button"');
    expect(html).toContain("No comments yet. Start the discussion!");
  });

  it("2. renders comments with MentionDisplay, highlighting mentions and preserving plain text", () => {
    const client = createTestQueryClient();
    const commentWithMention: CommentNode = {
      id: "cmt-mention-1",
      description: `Hey @[Alice Smith](user:${mentionedUserId}), can you review this PR?`,
      parentId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      user: { id: currentUserId, username: "author" },
      children: []
    };

    client.setQueryData(["comments", issueId], [commentWithMention]);

    const html = renderWithProviders(
      <CardCommentsSection issueId={issueId} orgId={orgId} />,
      client
    );

    // Verifies comment item rendered
    expect(html).toContain('data-testid="comment-cmt-mention-1"');
    // Verifies mention badge was rendered by MentionDisplay
    expect(html).toContain('data-testid="mention-badge"');
    expect(html).toContain(`data-user-id="${mentionedUserId}"`);
    expect(html).toContain("@Alice Smith");
    expect(html).toContain("can you review this PR?");
  });

  it("3. renders reply and edit action buttons with 24-hour moderation rules", () => {
    const client = createTestQueryClient();
    const recentComment: CommentNode = {
      id: "cmt-recent",
      description: `Task assigned to @[Alice](user:${mentionedUserId})`,
      parentId: null,
      createdAt: new Date().toISOString(), // recent (<24h)
      deletedAt: null,
      user: { id: currentUserId, username: "author" },
      children: []
    };

    client.setQueryData(["comments", issueId], [recentComment]);

    const html = renderWithProviders(
      <CardCommentsSection issueId={issueId} orgId={orgId} />,
      client
    );

    expect(html).toContain('data-testid="reply-comment-cmt-recent"');
    expect(html).toContain('data-testid="edit-comment-cmt-recent"');
    expect(html).toContain('data-testid="delete-comment-cmt-recent"');
  });

  it("4. renders nested comment replies with mentions and indentation", () => {
    const client = createTestQueryClient();
    const userB = "22222222-2222-4222-8222-222222222222";

    const rootComment: CommentNode = {
      id: "cmt-root",
      description: `Parent comment with mention @[Alice](user:${mentionedUserId})`,
      parentId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      user: { id: currentUserId, username: "author" },
      children: [
        {
          id: "cmt-child-1",
          description: `Child reply mentioning @[Bob](user:${userB})`,
          parentId: "cmt-root",
          createdAt: new Date().toISOString(),
          deletedAt: null,
          user: { id: mentionedUserId, username: "alice" },
          children: []
        }
      ]
    };

    client.setQueryData(["comments", issueId], [rootComment]);

    const html = renderWithProviders(
      <CardCommentsSection issueId={issueId} orgId={orgId} />,
      client
    );

    expect(html).toContain('data-testid="comment-cmt-root"');
    expect(html).toContain('data-testid="comment-cmt-child-1"');
    expect(html).toContain("@Alice");
    expect(html).toContain("@Bob");
    expect(html).toContain(`data-user-id="${mentionedUserId}"`);
    expect(html).toContain(`data-user-id="${userB}"`);
  });
});
