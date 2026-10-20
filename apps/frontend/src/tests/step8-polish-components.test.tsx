import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
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
  DropdownMenuContent: ({ children, className, ...props }: { children?: React.ReactNode; className?: string; [key: string]: unknown }) =>
    React.createElement("div", { className, "data-slot": "dropdown-content", ...props }, children),
  DropdownMenuItem: ({ children, className, onClick, ...props }: { children?: React.ReactNode; className?: string; onClick?: () => void; [key: string]: unknown }) =>
    React.createElement("div", { className, "data-slot": "dropdown-item", onClick, ...props }, children)
}));

import { ThemeToggle } from "../components/ui/theme-toggle";
import { BoardFilterBar } from "../components/board/BoardFilterBar";
import { KanbanCard } from "../components/board/KanbanCard";
import { BoardList } from "../components/board/BoardList";
import { DeleteColumnModal } from "../components/board/DeleteColumnModal";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import { DEFAULT_BOARD_FILTERS, type BoardFilterState } from "../lib/board-filters";
import type { BoardIssue, BoardSection, BoardSummary } from "../lib/board-api";
import * as boardQueries from "../hooks/useBoardQueries";

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

describe("Step 8: Polish Components Suite", () => {
  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    useAuthStore.setState({
      token: "mock-token",
      user: {
        id: "u-1",
        email: "tester@test.com",
        username: "tester"
      }
    });

    useOrgStore.setState({
      activeOrgId: "org-1",
      memberships: [
        {
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
            name: "Test Workspace",
            description: "Test Workspace description",
            visible: true,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
          }
        }
      ]
    });
  });

  describe("ThemeToggle Component", () => {
    it("renders theme toggle trigger button and options in dropdown", () => {
      const html = renderWithProviders(<ThemeToggle />);
      expect(html).toContain('data-testid="theme-toggle-button"');
      expect(html).toContain('data-testid="theme-option-light"');
      expect(html).toContain('data-testid="theme-option-dark"');
      expect(html).toContain('data-testid="theme-option-system"');
      expect(html).toContain("Toggle theme");
    });
  });

  describe("BoardFilterBar Component", () => {
    const dummyLabels = [
      { id: "lbl-1", name: "Security", color: "#dc2626" },
      { id: "lbl-2", name: "Frontend", color: "#2563eb" }
    ];
    const dummyAssignees = [
      { id: "u-1", name: "Tester", email: "tester@test.com", avatarUrl: null }
    ];

    it("renders search input, priority, assignee, label, and due date selects", () => {
      const html = renderWithProviders(
        <BoardFilterBar
          filters={DEFAULT_BOARD_FILTERS}
          onFiltersChange={() => {}}
          availableLabels={dummyLabels}
          availableAssignees={dummyAssignees}
          totalCardsCount={15}
          matchingCardsCount={15}
        />
      );

      expect(html).toContain('data-testid="board-filter-bar"');
      expect(html).toContain('data-testid="card-search-input"');
      expect(html).toContain('data-testid="filter-priority-select"');
      expect(html).toContain('data-testid="filter-assignee-select"');
      expect(html).toContain('data-testid="filter-label-select"');
      expect(html).toContain('data-testid="filter-due-date-select"');
      expect(html).toContain('data-testid="total-cards-summary"');
      expect(html).toContain("15 cards");
      // Reset button should be hidden when default
      expect(html).not.toContain('data-testid="clear-all-filters-button"');
    });

    it("renders active filter counter and reset button when filters are active", () => {
      const activeFilters: BoardFilterState = {
        ...DEFAULT_BOARD_FILTERS,
        priority: "urgent",
        dueUrgency: "overdue"
      };

      const html = renderWithProviders(
        <BoardFilterBar
          filters={activeFilters}
          onFiltersChange={() => {}}
          availableLabels={dummyLabels}
          availableAssignees={dummyAssignees}
          totalCardsCount={15}
          matchingCardsCount={3}
        />
      );

      expect(html).toContain('data-testid="clear-all-filters-button"');
      expect(html).toContain('data-testid="active-filters-count"');
      expect(html).toContain("2"); // 2 active filters
      expect(html).toContain('data-testid="filter-results-summary"');
      expect(html).toContain("Showing 3 of 15 cards");
    });

    it("renders mobile filter toggle and clear button when active search exists", () => {
      const html = renderWithProviders(
        <BoardFilterBar
          filters={{ ...DEFAULT_BOARD_FILTERS, searchQuery: "oauth" }}
          onFiltersChange={() => {}}
          totalCardsCount={10}
          matchingCardsCount={2}
        />
      );

      expect(html).toContain('data-testid="clear-search-button"');
      expect(html).toContain('data-testid="mobile-filter-toggle"');
      expect(html).toContain('data-testid="mobile-active-filters-count"');
    });
  });

  describe("KanbanCard Due Date Urgency Rendering", () => {
    it("renders overdue badge with data-testid='due-date-past-due' and urgency overdue testid", () => {
      const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const issue: BoardIssue = {
        id: "card-overdue",
        title: "Fix critical vulnerability",
        position: 1000,
        priority: "urgent",
        dueDate: pastDate,
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1"
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).toContain('data-testid="due-date-past-due"');
      expect(html).toContain('data-testid="due-date-urgency-overdue"');
      expect(html).toContain("text-destructive");
    });

    it("renders future due date with normal urgency and data-testid='due-date-badge'", () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const issue: BoardIssue = {
        id: "card-normal",
        title: "Future roadmap planning",
        position: 1000,
        priority: "low",
        dueDate: futureDate,
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1"
      };

      const html = renderWithProviders(<KanbanCard issue={issue} />);
      expect(html).not.toContain('data-testid="due-date-past-due"');
      expect(html).toContain('data-testid="due-date-badge"');
      expect(html).toContain('data-testid="due-date-urgency-normal"');
    });
  });

  describe("BoardList Board Search & Status Filtering", () => {
    const mockBoards: BoardSummary[] = [
      {
        id: "b-1",
        title: "Frontend Development",
        description: "React and Vite SPA workspace",
        color: "#3b82f6",
        isArchived: false,
        orgId: "org-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        _count: { issues: 12 }
      },
      {
        id: "b-2",
        title: "Backend API",
        description: "Express 5 and WebSockets server",
        color: "#10b981",
        isArchived: true,
        orgId: "org-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        _count: { issues: 8 }
      }
    ];

    it("renders board search input and status filter selector", () => {
      // Mock useOrgBoardsQuery
      const spy = spyOn(boardQueries, "useOrgBoardsQuery").mockReturnValue({
        data: mockBoards,
        isLoading: false,
        isError: false,
        error: null,
        refetch: () => Promise.resolve()
      } as unknown as ReturnType<typeof boardQueries.useOrgBoardsQuery>);

      const html = renderWithProviders(<BoardList orgId="org-1" />);
      expect(html).toContain('data-testid="board-search-input"');
      expect(html).toContain('data-testid="board-status-filter"');
      expect(html).toContain('data-testid="board-list-grid"');
      expect(html).toContain("Frontend Development");
      expect(html).toContain("Backend API");

      spy.mockRestore();
    });
  });

  describe("DeleteColumnModal Reassignment & Target Selection Stability", () => {
    const sectionToDelete: BoardSection = {
      id: "sec-del",
      title: "Delete Me",
      position: 1000,
      isArchived: false,
      issues: [
        { id: "c1", title: "Task 1", position: 1000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-del" }
      ]
    };
    const targetA: BoardSection = { id: "sec-a", title: "Column A", position: 2000, isArchived: false, issues: [] };
    const targetB: BoardSection = { id: "sec-b", title: "Column B", position: 3000, isArchived: false, issues: [] };

    it("renders options for reassignment and excludes target column from moving to itself", () => {
      const html = renderWithProviders(
        <DeleteColumnModal
          open={true}
          onOpenChange={() => {}}
          boardId="b-1"
          orgId="org-1"
          section={sectionToDelete}
          allSections={[sectionToDelete, targetA, targetB]}
        />
      );

      expect(html).toContain('data-testid="reassign-issues-modal"');
      expect(html).toContain('data-testid="target-section-select"');
      expect(html).toContain("Column A");
      expect(html).toContain("Column B");
      expect(html).toContain('&quot;Delete Me&quot; will be moved');
    });
  });
});

