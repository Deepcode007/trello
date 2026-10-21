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

import { BoardCard } from "../components/board/BoardCard";
import { CreateBoardModal, BOARD_COLOR_PRESETS } from "../components/board/CreateBoardModal";
import { BoardHeader } from "../components/board/BoardHeader";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import type { BoardSummary, BoardDetail } from "../lib/board-api";
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

describe("Board UI Components", () => {
  const testMembership: UserOrgMembership = {
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
      name: "Acme Software",
      description: "Development team workspace",
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
      memberships: [testMembership],
      activeOrgId: "org-1"
    });

    useAuthStore.setState({
      token: "mock-token",
      user: {
        id: "u-1",
        email: "alice@acme.com",
        username: "alice",
        name: "Alice Smith"
      }
    });

    useBoardStore.getState().resetBoardState();
  });

  describe("BoardCard", () => {
    const mockBoard: BoardSummary = {
      id: "board-101",
      title: "Sprint Alpha",
      description: "Q4 feature backlog and sprint board",
      color: "#10b981",
      isArchived: false,
      orgId: "org-1",
      _count: { issues: 14 }
    };

    it("renders board title, description, and issue count", () => {
      const html = renderWithProviders(React.createElement(BoardCard, { board: mockBoard, orgId: "org-1" }));
      expect(html).toContain("Sprint Alpha");
      expect(html).toContain("Q4 feature backlog and sprint board");
      expect(html).toContain("14 cards");
      expect(html).toContain("background-color:#10b981");
    });

    it("renders fallback message when description is null", () => {
      const boardWithoutDesc = { ...mockBoard, description: null };
      const html = renderWithProviders(React.createElement(BoardCard, { board: boardWithoutDesc, orgId: "org-1" }));
      expect(html).toContain("No description provided");
    });

    it("renders Archived badge when isArchived is true", () => {
      const archivedBoard = { ...mockBoard, isArchived: true };
      const html = renderWithProviders(React.createElement(BoardCard, { board: archivedBoard, orgId: "org-1" }));
      expect(html).toContain("Archived");
    });
  });

  describe("CreateBoardModal", () => {
    it("renders dialog with title, description input, and color preset swatches", () => {
      const html = renderWithProviders(
        React.createElement(CreateBoardModal, {
          open: true,
          onOpenChange: () => {},
          orgId: "org-1"
        })
      );

      expect(html).toContain("Create Board");
      expect(html).toContain("Board Title");
      expect(html).toContain("Description (optional)");
      expect(html).toContain("Color Accent");

      for (const preset of BOARD_COLOR_PRESETS) {
        expect(html).toContain(preset.value);
      }
    });

    it("displays warning banner when user is a contributor without creation rights", () => {
      useOrgStore.setState({
        memberships: [{ ...testMembership, role: "contributor" }],
        activeOrgId: "org-1"
      });

      const html = renderWithProviders(
        React.createElement(CreateBoardModal, {
          open: true,
          onOpenChange: () => {},
          orgId: "org-1"
        })
      );

      expect(html).toContain("Only organization admins and employees can create boards");
    });
  });

  describe("BoardHeader", () => {
    const mockDetail: BoardDetail = {
      id: "board-101",
      title: "Sprint Alpha",
      description: "Sprint board",
      color: "#8b5cf6",
      isArchived: false,
      orgId: "org-1"
    };

    it("renders breadcrumbs with organization name and board title", () => {
      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("Acme Software");
      expect(html).toContain("Sprint Alpha");
      expect(html).toContain("background-color:#8b5cf6");
    });

    it("renders collaborator presence avatar stack including current user and displays user name on hover", () => {
      useBoardStore.setState({
        collaborators: {
          "u-2": { userId: "u-2", name: "Bob Jones", email: "bob@example.com" },
          "u-3": { userId: "u-3", name: "carol@example.com", email: "carol@example.com" }
        }
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("collaborator-avatar-stack");
      expect(html).toContain("collaborator-avatar-u-1");
      expect(html).toContain("collaborator-avatar-u-2");
      expect(html).toContain("collaborator-avatar-u-3");
      expect(html).toContain('title="Bob Jones"');
      // Verify hover title shows user name ("carol") and never the full email
      expect(html).toContain('title="carol"');
      expect(html).not.toContain('title="carol@example.com"');
    });

    it("displays overflow badge when active collaborators exceed 5", () => {
      const manyCollabs: Record<string, { userId: string; name: string }> = {};
      for (let i = 1; i <= 7; i++) {
        manyCollabs[`u-${i}`] = { userId: `u-${i}`, name: `User ${i}` };
      }
      useBoardStore.setState({ collaborators: manyCollabs });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("+");
    });

    it("renders real-time connection status badges for connected, reconnecting, and disconnected states", () => {
      // Connected
      useBoardStore.getState().setConnectionStatus("connected");
      let html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("Connected");

      // Reconnecting
      useBoardStore.getState().setConnectionStatus("reconnecting");
      html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("Reconnecting...");

      // Disconnected
      useBoardStore.getState().setConnectionStatus("disconnected");
      html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("Disconnected");
    });

    it("shows inline rename and actions dropdown for admin / employee", () => {
      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).toContain("inline-rename-trigger");
      expect(html).toContain("board-actions-trigger");
    });

    it("hides rename trigger and board actions dropdown for contributor", () => {
      useOrgStore.setState({
        memberships: [{ ...testMembership, role: "contributor" }],
        activeOrgId: "org-1"
      });

      const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
      expect(html).not.toContain("inline-rename-trigger");
      expect(html).not.toContain("board-actions-trigger");
    });
  });
});
