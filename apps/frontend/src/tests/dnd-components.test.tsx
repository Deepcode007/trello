import { describe, it, expect, beforeEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import * as RealDropdownUI from "../components/ui/dropdown-menu";
import * as RealDialogUI from "../components/ui/dialog";

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
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import type { BoardDetail, BoardSection, BoardIssue } from "../lib/board-api";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
}

function renderComponent(ui: React.ReactElement, client = createTestQueryClient()) {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(MemoryRouter, null, ui)
    )
  );
}

describe("Step 6: Independent Specification Test — DND Components & Accessibility", () => {
  const mockOrgId = "org-dnd-123";
  const mockUserId = "user-dnd-456";

  const sampleCard: BoardIssue = {
    id: "card-sample-1",
    title: "Implement Drag and Drop Handlers",
    position: 1000,
    priority: "urgent",
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    isArchived: false,
    boardId: "board-1",
    sectionId: "sec-1",
    labels: [
      { label: { id: "lbl-1", name: "Frontend", color: "#3b82f6" } }
    ],
    issueMappings: [
      { user: { id: "u1", username: "alice", name: "Alice", email: "alice@test.com", avatarUrl: null } }
    ],
    checklists: [
      {
        id: "chk-1",
        title: "Tasks",
        position: 1000,
        items: [
          { id: "i1", isCompleted: true, title: "Subtask 1" },
          { id: "i2", isCompleted: false, title: "Subtask 2" }
        ]
      }
    ]
  };

  const sampleSection: BoardSection = {
    id: "sec-1",
    title: "In Progress",
    position: 1000,
    wipLimit: 3,
    isArchived: false,
    issues: [sampleCard]
  };

  const sampleBoard: BoardDetail = {
    id: "board-1",
    title: "Project Alpha",
    description: "Main workspace board",
    color: "#3b82f6",
    isArchived: false,
    orgId: mockOrgId,
    section: [sampleSection]
  };

  beforeEach(() => {
    // Monkey-patch useSyncExternalStore for Zustand in React 19 SSR
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    useOrgStore.getState().resetOrgState();
    useAuthStore.setState({
      user: { id: mockUserId, email: "tester@test.com", username: "tester" },
      token: "mock-token"
    });
    useOrgStore.setState({
      activeOrgId: mockOrgId,
      memberships: [
        {
          id: "m-1",
          userId: mockUserId,
          orgId: mockOrgId,
          role: "admin",
          accepted: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          acceptedAt: "2026-01-01T00:00:00Z",
          org: {
            id: mockOrgId,
            name: "Test Org",
            description: "Test",
            visible: true,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
          }
        }
      ]
    });
  });

  describe("1. KanbanCard DND Render & DragOverlay", () => {
    it("renders sortable card with data-testid and accessibility attributes", () => {
      const html = renderComponent(<KanbanCard issue={sampleCard} />);
      expect(html).toContain('data-testid="card-card-sample-1"');
      expect(html).toContain("Implement Drag and Drop Handlers");
      expect(html).toContain("Frontend");
      expect(html).toContain("urgent");
      expect(html).toContain('data-testid="card-checklist-ratio"');
      expect(html).toContain("1/2");
    });

    it("renders card in DragOverlay mode with elevated shadow and tilt styling", () => {
      const html = renderComponent(<KanbanCard issue={sampleCard} isOverlay={true} />);
      expect(html).toContain('data-testid="card-card-sample-1"');
      expect(html).toContain("shadow-2xl");
      expect(html).toContain("rotate-1");
      expect(html).toContain("cursor-grabbing");
    });
  });

  describe("2. KanbanColumn Drag Handle & Droppable Container", () => {
    it("renders column with dedicated drag handle for admin/editor", () => {
      const html = renderComponent(
        <KanbanColumn
          section={sampleSection}
          boardId="board-1"
          orgId={mockOrgId}
          allSections={[sampleSection]}
        />
      );

      expect(html).toContain('data-testid="column-sec-1"');
      expect(html).toContain('data-testid="column-drag-handle-sec-1"');
      expect(html).toContain('aria-label="Drag column In Progress"');
      expect(html).toContain('data-testid="column-cards-sec-1"');
      expect(html).toContain('data-testid="card-card-sample-1"');
    });

    it("renders empty droppable column placeholder when section has zero cards", () => {
      const emptySection: BoardSection = {
        id: "sec-empty-1",
        title: "Done",
        position: 2000,
        wipLimit: 5,
        isArchived: false,
        issues: []
      };

      const html = renderComponent(
        <KanbanColumn
          section={emptySection}
          boardId="board-1"
          orgId={mockOrgId}
          allSections={[emptySection]}
        />
      );

      expect(html).toContain('data-testid="column-sec-empty-1"');
      expect(html).toContain('data-testid="column-cards-sec-empty-1"');
      expect(html).toContain("No cards in column");
    });

    it("renders column in DragOverlay mode with elevated styling", () => {
      const html = renderComponent(
        <KanbanColumn
          section={sampleSection}
          boardId="board-1"
          orgId={mockOrgId}
          allSections={[sampleSection]}
          isOverlay={true}
        />
      );

      expect(html).toContain('data-testid="column-sec-1"');
      expect(html).toContain("shadow-2xl");
      expect(html).toContain("rotate-1");
    });
  });

  describe("3. KanbanCanvas Multi-Container DND Orchestration", () => {
    it("renders horizontal board canvas with columns and add column button", () => {
      const html = renderComponent(<KanbanCanvas board={sampleBoard} />);
      expect(html).toContain('data-testid="board-canvas-viewport"');
      expect(html).toContain('data-testid="column-sec-1"');
      expect(html).toContain('data-testid="add-column-button"');
    });

    it("renders empty canvas ready state when board has no columns", () => {
      const emptyBoard: BoardDetail = {
        ...sampleBoard,
        section: []
      };

      const html = renderComponent(<KanbanCanvas board={emptyBoard} />);
      expect(html).toContain('data-testid="board-canvas-viewport"');
      expect(html).toContain('data-testid="canvas-empty-columns"');
      expect(html).toContain("Canvas Ready");
      expect(html).toContain('data-testid="create-first-column-button"');
    });

    it("orders columns strictly by ascending position", () => {
      const multiSectionBoard: BoardDetail = {
        ...sampleBoard,
        section: [
          { id: "sec-c", title: "Review", position: 3000, isArchived: false, issues: [] },
          { id: "sec-a", title: "Backlog", position: 1000, isArchived: false, issues: [] },
          { id: "sec-b", title: "In Dev", position: 2000, isArchived: false, issues: [] }
        ]
      };

      const html = renderComponent(<KanbanCanvas board={multiSectionBoard} />);
      const posA = html.indexOf('data-testid="column-sec-a"');
      const posB = html.indexOf('data-testid="column-sec-b"');
      const posC = html.indexOf('data-testid="column-sec-c"');

      expect(posA).toBeLessThan(posB);
      expect(posB).toBeLessThan(posC);
    });
  });
});
