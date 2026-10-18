import { describe, it, expect, beforeEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock Radix portals
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

import { BoardCanvasPage } from "../pages/BoardCanvasPage";
import { useOrgStore } from "../store/useOrgStore";
import { useAuthStore } from "../store/useAuthStore";
import { useBoardStore } from "../store/useBoardStore";
import type { BoardDetail } from "../lib/board-api";
import type { UserOrgMembership } from "../lib/org-api";

function renderCanvasWithRoute(
  client: QueryClient,
  initialRoute = "/orgs/org-1/boards/board-1"
) {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        MemoryRouter,
        { initialEntries: [initialRoute] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/orgs/:orgId/boards/:boardId",
            element: React.createElement(BoardCanvasPage, null)
          })
        )
      )
    )
  );
}

describe("BoardCanvasPage rendering and error handling", () => {
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
      name: "Engineering Corp",
      description: "Dev Workspace",
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
      token: "valid-token",
      user: { id: "u-1", email: "dev@corp.com", username: "dev" }
    });

    useBoardStore.getState().resetBoardState();
  });

  it("renders loading skeleton while board data is pending", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: () => new Promise(() => {}), // Never resolves
          retry: false
        }
      }
    });

    const html = renderCanvasWithRoute(client);
    expect(html).toContain("canvas-loading-skeleton");
  });

  it("renders 404 error card when board does not exist", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity
        }
      }
    });

    // Create query entry via QueryClient hashing
    client.setQueryData(["board", "board-1"], null);
    const query = client.getQueryCache().find({ queryKey: ["board", "board-1"] });
    query?.setState({
      status: "error",
      error: Object.assign(new Error("Board not found"), {
        response: { status: 404, data: { error: "Board not found" } }
      }),
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle"
    });

    const html = renderCanvasWithRoute(client);
    expect(html).toContain("canvas-error-404");
    expect(html).toContain("Board Not Found");
    expect(html).toContain("Return to Dashboard");
  });

  it("renders 403 error card when user is not authorized or not a member", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity
        }
      }
    });

    // Create query entry via QueryClient hashing
    client.setQueryData(["board", "board-1"], null);
    const query = client.getQueryCache().find({ queryKey: ["board", "board-1"] });
    query?.setState({
      status: "error",
      error: Object.assign(new Error("Forbidden"), {
        response: { status: 403, data: { error: "Member access only" } }
      }),
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle"
    });

    const html = renderCanvasWithRoute(client);
    expect(html).toContain("canvas-error-403");
    expect(html).toContain("Access Denied");
    expect(html).toContain("Return to Dashboard");
  });

  it("renders canvas viewport and columns when board details load successfully", () => {
    const mockBoardDetail: BoardDetail = {
      id: "board-1",
      title: "Kanban Sprint 1",
      description: "Sprint tasks",
      color: "#3b82f6",
      isArchived: false,
      orgId: "org-1",
      section: [
        {
          id: "sec-todo",
          title: "To Do",
          position: 1000,
          isArchived: false,
          issues: [
            {
              id: "iss-101",
              title: "Setup API Client",
              position: 1000,
              priority: "high",
              isArchived: false,
              boardId: "board-1",
              sectionId: "sec-todo"
            }
          ]
        }
      ]
    };

    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    });
    client.setQueryData(["board", "board-1"], mockBoardDetail);

    const html = renderCanvasWithRoute(client);
    expect(html).toContain("board-header");
    expect(html).toContain("Kanban Sprint 1");
    expect(html).toContain("board-canvas-viewport");
    expect(html).toContain("column-sec-todo");
    expect(html).toContain("Setup API Client");
  });

  it("renders canvas ready empty state when board has zero columns", () => {
    const mockEmptyBoard: BoardDetail = {
      id: "board-1",
      title: "Fresh Board",
      description: null,
      color: "#10b981",
      isArchived: false,
      orgId: "org-1",
      section: []
    };

    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    });
    client.setQueryData(["board", "board-1"], mockEmptyBoard);

    const html = renderCanvasWithRoute(client);
    expect(html).toContain("canvas-empty-columns");
    expect(html).toContain("Canvas Ready");
  });
});
