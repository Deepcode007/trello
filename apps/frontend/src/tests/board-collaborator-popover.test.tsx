import { describe, it, expect, beforeEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealPopoverUI from "../components/ui/popover";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock Radix popover to render trigger and popover card content directly in SSR test harness
mock.module("../components/ui/popover", () => ({
  ...RealPopoverUI,
  Popover: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-slot": "popover-root" }, children),
  PopoverTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) =>
    React.createElement("div", { "data-slot": "popover-trigger" }, children),
  PopoverPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  PopoverContent: ({ children, className, "data-testid": testId }: { children?: React.ReactNode; className?: string; "data-testid"?: string }) =>
    React.createElement("div", { className, "data-slot": "popover-content", "data-testid": testId }, children)
}));

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

import { BoardHeader, formatRank, getDisplayName } from "../components/board/BoardHeader";
import { useBoardStore } from "../store/useBoardStore";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import { processCollaboratorsFromEvent } from "../hooks/useBoardSocket";
import type { BoardDetail } from "../lib/board-api";
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

describe("Board Header Collaborator Hover & Click Popover Suite", () => {
  const mockBoard: BoardDetail = {
    id: "board-collab-test",
    title: "Feature Team Alpha",
    description: "Team Board",
    color: "#3b82f6",
    isArchived: false,
    orgId: "org-collab-test"
  };

  const testMembership: UserOrgMembership = {
    id: "mem-host",
    role: "admin",
    accepted: true,
    userId: "usr-host",
    orgId: "org-collab-test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    org: {
      id: "org-collab-test",
      name: "Engineering Org",
      description: "Engineering Team",
      visible: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    useBoardStore.getState().resetBoardState();
    useOrgStore.setState({
      activeOrgId: "org-collab-test",
      memberships: [testMembership]
    });
    useAuthStore.setState({
      token: "valid-jwt",
      user: {
        id: "usr-host",
        email: "alice.host@company.com",
        username: "alice_host",
        name: "Alice Host"
      }
    });
  });

  describe("1. formatRank and getDisplayName Helpers", () => {
    it("formats rank values properly into capitalized user-friendly labels", () => {
      expect(formatRank("admin")).toBe("Admin");
      expect(formatRank("employee")).toBe("Employee");
      expect(formatRank("contributor")).toBe("Contributor");
      expect(formatRank("ADMIN")).toBe("Admin");
      expect(formatRank("")).toBe("Member");
      expect(formatRank("   ")).toBe("Member");
      expect(formatRank(undefined)).toBe("Member");
    });

    it("extracts clean display name and never defaults to email address", () => {
      expect(getDisplayName({ name: "Bob Smith", email: "bob@example.com" })).toBe("Bob Smith");
      expect(getDisplayName({ name: "bob@example.com", email: "bob@example.com" })).toBe("bob");
      expect(getDisplayName({ name: undefined, username: "bob_dev", email: "bob@example.com" })).toBe("bob_dev");
      expect(getDisplayName({ name: null, username: null, email: "charlie@domain.org" })).toBe("charlie");
      expect(getDisplayName({ name: "   ", username: "   ", email: "   " })).toBe("Collaborator");
      expect(getDisplayName(undefined)).toBe("Collaborator");
    });
  });

  describe("2. On-Hover Collaborator Name Display", () => {
    it("displays user name on hover via both title attribute and hover tooltip element, with open suppression", () => {
      useBoardStore.setState({
        collaborators: {
          "usr-bob": {
            userId: "usr-bob",
            name: "Bob Jones",
            email: "bob@company.com",
            role: "employee"
          },
          "usr-carol": {
            userId: "usr-carol",
            name: "carol",
            email: "carol@company.com",
            role: "contributor"
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }));

      // Avatar stack rendered
      expect(html).toContain("collaborator-avatar-stack");

      // Verify host hover
      expect(html).toContain('data-testid="collaborator-hover-name-usr-host"');
      expect(html).toContain("Alice Host");
      expect(html).toContain('title="Alice Host"');

      // Verify Bob hover
      expect(html).toContain('data-testid="collaborator-hover-name-usr-bob"');
      expect(html).toContain("Bob Jones");
      expect(html).toContain('title="Bob Jones"');

      // Verify Carol hover (email was filtered to clean username)
      expect(html).toContain('data-testid="collaborator-hover-name-usr-carol"');
      expect(html).toContain("carol");
      expect(html).toContain('title="carol"');
      expect(html).not.toContain('title="carol@company.com"');

      // Verify hover tooltip has suppression styling to avoid colliding with opened popover card
      expect(html).toContain("group-data-[state=open]:hidden");
      expect(html).toContain("group-aria-expanded:hidden");

      // Verify keyboard focus accessibility
      expect(html).toContain("group-focus-visible:flex");

      // Verify hover card positioning and header z-index to avoid bottom cut-off
      expect(html).toContain("relative z-20");
      expect(html).toContain("top-full mt-1.5");
      expect(html).not.toContain("-bottom-8");
    });

    it("handles collaborators with unusually long names and whitespace-padded roles gracefully", () => {
      useBoardStore.setState({
        collaborators: {
          "usr-long": {
            userId: "usr-long",
            name: "Dr. Bartholomew Archibald Montgomery III",
            email: "long.name@company.com",
            role: "   " // whitespace role should fallback to Member
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }));

      // Name is present in hover tooltip and popover
      expect(html).toContain('data-testid="collaborator-hover-name-usr-long"');
      expect(html).toContain("Dr. Bartholomew Archibald Montgomery III");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-long"');
      expect(html).toContain("Member");
    });
  });

  describe("3. On-Click Collaborator Details Card (Email and Rank)", () => {
    it("renders popover card showing name, email, and rank for connected collaborators", () => {
      useBoardStore.setState({
        collaborators: {
          "usr-bob": {
            userId: "usr-bob",
            name: "Bob Jones",
            email: "bob@company.com",
            role: "employee",
            rank: "employee"
          },
          "usr-carol": {
            userId: "usr-carol",
            name: "Carol White",
            email: "carol@company.com",
            role: "contributor",
            rank: "contributor"
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }));

      // Host popover contains Alice Host, email, and Admin rank
      expect(html).toContain('data-testid="collaborator-popover-name-usr-host"');
      expect(html).toContain("Alice Host");
      expect(html).toContain('data-testid="collaborator-popover-email-usr-host"');
      expect(html).toContain("alice.host@company.com");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-host"');
      expect(html).toContain("Admin");

      // Bob popover contains Bob Jones, email, and Employee rank
      expect(html).toContain('data-testid="collaborator-popover-name-usr-bob"');
      expect(html).toContain("Bob Jones");
      expect(html).toContain('data-testid="collaborator-popover-email-usr-bob"');
      expect(html).toContain("bob@company.com");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-bob"');
      expect(html).toContain("Employee");

      // Carol popover contains Carol White, email, and Contributor rank
      expect(html).toContain('data-testid="collaborator-popover-name-usr-carol"');
      expect(html).toContain("Carol White");
      expect(html).toContain('data-testid="collaborator-popover-email-usr-carol"');
      expect(html).toContain("carol@company.com");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-carol"');
      expect(html).toContain("Contributor");
    });

    it("resolves member rank from TanStack query cache by matching email when socket object omits explicit role", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-collab-test"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-collab-test",
          user: {
            username: "dave_dev",
            email: "dave@company.com"
          }
        }
      ]);

      useBoardStore.setState({
        collaborators: {
          "usr-dave": {
            userId: "usr-dave",
            name: "Dave Developer",
            email: "dave@company.com"
            // No explicit role on collaborator object
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }), client);

      expect(html).toContain('data-testid="collaborator-popover-name-usr-dave"');
      expect(html).toContain("Dave Developer");
      expect(html).toContain('data-testid="collaborator-popover-email-usr-dave"');
      expect(html).toContain("dave@company.com");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-dave"');
      expect(html).toContain("Employee");
    });

    it("resolves member email and rank from TanStack query cache by matching username when email is missing from socket", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-collab-test"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-collab-test",
          user: {
            username: "frank_the_tank",
            email: "frank@company.com"
          }
        }
      ]);

      useBoardStore.setState({
        collaborators: {
          "usr-frank": {
            userId: "usr-frank",
            name: "frank_the_tank"
            // No email, no role on socket payload
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }), client);

      expect(html).toContain('data-testid="collaborator-popover-name-usr-frank"');
      expect(html).toContain("frank_the_tank");
      expect(html).toContain('data-testid="collaborator-popover-email-usr-frank"');
      expect(html).toContain("frank@company.com");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-frank"');
      expect(html).toContain("Employee");
    });

    it("falls back gracefully to 'Member' when rank cannot be determined and email is missing", () => {
      useBoardStore.setState({
        collaborators: {
          "usr-unknown": {
            userId: "usr-unknown",
            name: "Mystery User"
            // No email, no role
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }));

      expect(html).toContain('data-testid="collaborator-popover-name-usr-unknown"');
      expect(html).toContain("Mystery User");
      expect(html).toContain('data-testid="collaborator-popover-email-usr-unknown"');
      expect(html).toContain("No email available");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-unknown"');
      expect(html).toContain("Member");
    });
  });

  describe("4. Overflow Popover for More Than 5 Collaborators", () => {
    it("renders overflow popover showing names, emails, and ranks for all overflow users", () => {
      const manyCollabs: Record<string, { userId: string; name: string; email: string; role: string }> = {};
      for (let i = 1; i <= 6; i++) {
        manyCollabs[`usr-${i}`] = {
          userId: `usr-${i}`,
          name: `User ${i}`,
          email: `user${i}@company.com`,
          role: i % 2 === 0 ? "employee" : "contributor"
        };
      }
      useBoardStore.setState({ collaborators: manyCollabs });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }));

      expect(html).toContain("collaborator-overflow-badge");
      expect(html).toContain("+2"); // 1 host + 6 collabs = 7 total -> displayed 5, overflow 2
      expect(html).toContain("data-testid=\"collaborator-overflow-popover\"");
      expect(html).toContain("Other Connected Users (2)");
      expect(html).toContain("user5@company.com");
      expect(html).toContain("user6@company.com");
      expect(html).toContain('data-testid="collaborator-overflow-email-usr-5"');
      expect(html).toContain('data-testid="collaborator-overflow-rank-usr-5"');
      expect(html).toContain("Contributor");
      expect(html).toContain('data-testid="collaborator-overflow-email-usr-6"');
      expect(html).toContain('data-testid="collaborator-overflow-rank-usr-6"');
      expect(html).toContain("Employee");
    });
  });

  describe("5. Socket Payload Email & Name Preservation", () => {
    it("preserves both email and clean name in processCollaboratorsFromEvent without stripping email", () => {
      const socketJoinedEvent = {
        type: "joined",
        boardId: "board-collab-test",
        users: [
          {
            userId: "usr-sam",
            name: "Sam Wilson",
            email: "sam.wilson@avengers.org",
            role: "employee"
          },
          {
            userId: "usr-bucky",
            name: "bucky@avengers.org", // name contains email
            email: "bucky@avengers.org",
            rank: "contributor"
          }
        ]
      };

      const result = processCollaboratorsFromEvent(socketJoinedEvent);
      expect(result).not.toBeNull();

      // Sam has real name and original email preserved
      expect(result!["usr-sam"]?.name).toBe("Sam Wilson");
      expect(result!["usr-sam"]?.email).toBe("sam.wilson@avengers.org");
      expect(result!["usr-sam"]?.role).toBe("employee");
      expect(result!["usr-sam"]?.rank).toBe("employee");

      // Bucky had email in name, cleaned name to prefix, original email untouched
      expect(result!["usr-bucky"]?.name).toBe("bucky");
      expect(result!["usr-bucky"]?.email).toBe("bucky@avengers.org");
      expect(result!["usr-bucky"]?.role).toBe("contributor");
      expect(result!["usr-bucky"]?.rank).toBe("contributor");
    });
  });

  describe("6. Real Name Resolution for Other Connected Users from orgMembers", () => {
    it("resolves other users' real names from orgMembers when socket payload only had email prefix", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-collab-test"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-collab-test",
          userId: "usr-bob",
          user: {
            id: "usr-bob",
            name: "Robert Bob Jones",
            username: "bob_dev",
            email: "bob@company.com"
          }
        },
        {
          role: "contributor",
          accepted: true,
          orgId: "org-collab-test",
          userId: "usr-carol",
          user: {
            id: "usr-carol",
            name: "Carol Danvers",
            username: "carol_d",
            email: "carol@company.com"
          }
        }
      ]);

      // Socket payload only has email prefix ("bob") for user bob, and "carol" for user carol
      useBoardStore.setState({
        collaborators: {
          "usr-bob": {
            userId: "usr-bob",
            name: "bob",
            email: "bob@company.com"
          },
          "usr-carol": {
            userId: "usr-carol",
            name: "carol",
            email: "carol@company.com"
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }), client);

      // Current user still shows their own real name
      expect(html).toContain('data-testid="collaborator-hover-name-usr-host"');
      expect(html).toContain("Alice Host");
      expect(html).toContain('data-testid="collaborator-popover-name-usr-host"');

      // Bob's real name is resolved and displayed on hover and in popover instead of "bob"
      expect(html).toContain('data-testid="collaborator-hover-name-usr-bob"');
      expect(html).toContain("Robert Bob Jones");
      expect(html).toContain('title="Robert Bob Jones"');
      expect(html).toContain('aria-label="Robert Bob Jones"');
      expect(html).toContain('data-testid="collaborator-popover-name-usr-bob"');

      // Carol's real name is resolved and displayed on hover and in popover instead of "carol"
      expect(html).toContain('data-testid="collaborator-hover-name-usr-carol"');
      expect(html).toContain("Carol Danvers");
      expect(html).toContain('title="Carol Danvers"');
      expect(html).toContain('aria-label="Carol Danvers"');
      expect(html).toContain('data-testid="collaborator-popover-name-usr-carol"');
    });

    it("resolves other users' real names when socket payload has only userId", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-collab-test"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-collab-test",
          userId: "usr-dave",
          user: {
            id: "usr-dave",
            name: "Dave Bautista",
            username: "dave_b",
            email: "dave@company.com"
          }
        }
      ]);

      useBoardStore.setState({
        collaborators: {
          "usr-dave": {
            userId: "usr-dave"
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }), client);

      expect(html).toContain('data-testid="collaborator-hover-name-usr-dave"');
      expect(html).toContain("Dave Bautista");
      expect(html).toContain('title="Dave Bautista"');
      expect(html).toContain('data-testid="collaborator-popover-name-usr-dave"');
      expect(html).toContain('data-testid="collaborator-popover-email-usr-dave"');
      expect(html).toContain("dave@company.com");
      expect(html).toContain('data-testid="collaborator-popover-rank-usr-dave"');
      expect(html).toContain("Employee");
    });

    it("prevents false-positive email prefix collision when two org members share prefixes", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-collab-test"], [
        {
          role: "employee",
          accepted: true,
          orgId: "org-collab-test",
          userId: "usr-alexander",
          user: {
            id: "usr-alexander",
            name: "Alexander Great",
            username: "alexander",
            email: "alexander@company.com"
          }
        },
        {
          role: "employee",
          accepted: true,
          orgId: "org-collab-test",
          userId: "usr-alex",
          user: {
            id: "usr-alex",
            name: "Alex Cooper",
            username: "alex",
            email: "alex@company.com"
          }
        }
      ]);

      useBoardStore.setState({
        collaborators: {
          "usr-alex": {
            userId: "usr-alex",
            name: "alex",
            email: "alex@company.com"
          }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }), client);

      // Must resolve specifically to Alex Cooper, not Alexander Great
      expect(html).toContain('data-testid="collaborator-hover-name-usr-alex"');
      expect(html).toContain("Alex Cooper");
      expect(html).not.toContain("Alexander Great");
    });

    it("resolves current user real name from orgMembers when auth store user only has email prefix", () => {
      const client = createTestQueryClient();
      client.setQueryData(["orgMembers", "org-collab-test"], [
        {
          role: "admin",
          accepted: true,
          orgId: "org-collab-test",
          userId: "usr-host",
          user: {
            id: "usr-host",
            name: "Alice Real Hostname",
            username: "alice_host",
            email: "alice.host@company.com"
          }
        }
      ]);

      // Current user in auth store only has email and username/name set to email prefix
      useAuthStore.setState({
        user: {
          id: "usr-host",
          email: "alice.host@company.com",
          name: "alice.host", // just email prefix
          username: "alice.host"
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockBoard }), client);

      // Verify current user resolves their real name from orgMembers
      expect(html).toContain('data-testid="collaborator-hover-name-usr-host"');
      expect(html).toContain("Alice Real Hostname");
      expect(html).toContain('title="Alice Real Hostname"');
    });
  });
});
