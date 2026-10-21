import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BoardDetail } from "../lib/board-api";
import { useMoveIssueMutation, useUpdateSectionMutation } from "../hooks/useKanbanQueries";
import { kanbanApi } from "../lib/kanban-api";

describe("Step 6: Independent Specification Test — Optimistic Cache Updates & Error Rollback", () => {
  let queryClient: QueryClient;
  const boardId = "board-123";
  const originalMoveIssue = kanbanApi.moveIssue;
  const originalUpdateSection = kanbanApi.updateSection;

  afterEach(() => {
    kanbanApi.moveIssue = originalMoveIssue;
    kanbanApi.updateSection = originalUpdateSection;
  });

  const initialMockBoard: BoardDetail = {
    id: boardId,
    title: "Test Kanban Board",
    description: "Testing drag and drop cache updates",
    color: "#4f46e5",
    isArchived: false,
    orgId: "org-1",
    section: [
      {
        id: "sec-todo",
        title: "To Do",
        position: 1000,
        wipLimit: 5,
        isArchived: false,
        issues: [
          {
            id: "card-1",
            title: "Task 1",
            position: 1000,
            priority: "medium",
            isArchived: false,
            boardId,
            sectionId: "sec-todo"
          },
          {
            id: "card-2",
            title: "Task 2",
            position: 2000,
            priority: "high",
            isArchived: false,
            boardId,
            sectionId: "sec-todo"
          }
        ]
      },
      {
        id: "sec-done",
        title: "Done",
        position: 2000,
        wipLimit: 2,
        isArchived: false,
        issues: [
          {
            id: "card-3",
            title: "Task 3",
            position: 1000,
            priority: "low",
            isArchived: false,
            boardId,
            sectionId: "sec-done"
          }
        ]
      },
      {
        id: "sec-empty",
        title: "Empty Column",
        position: 3000,
        wipLimit: null,
        isArchived: false,
        issues: []
      }
    ]
  };

  let moveCardAsync: (vars: { issueId: string; sectionId: string; position?: number }) => Promise<unknown>;
  let updateSectionAsync: (vars: { sectionId: string; updates: { title?: string; wipLimit?: number | null; position?: number } }) => Promise<unknown>;

  function TestHarness() {
    const moveMut = useMoveIssueMutation(boardId);
    const updateMut = useUpdateSectionMutation(boardId);
    moveCardAsync = moveMut.mutateAsync;
    updateSectionAsync = updateMut.mutateAsync;
    return null;
  }

  function setupHarness() {
    renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(TestHarness)
      )
    );
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });
    // Prime query cache with initial board state
    queryClient.setQueryData(["board", boardId], initialMockBoard);
    setupHarness();
  });

  describe("1. Card Movement Optimistic Cache Mutation", () => {
    it("optimistically moves a card across sections and reflects immediately in cache", async () => {
      // Mock API call to succeed
      const moveSpy = mock(() => Promise.resolve({
        id: "card-1",
        sectionId: "sec-done",
        position: 500,
        title: "Task 1",
        priority: "medium" as const,
        isArchived: false,
        boardId
      }));
      kanbanApi.moveIssue = moveSpy as unknown as typeof kanbanApi.moveIssue;

      await moveCardAsync({
        issueId: "card-1",
        sectionId: "sec-done",
        position: 500
      });

      // Assert that cache was updated
      const updatedBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      expect(updatedBoard).toBeDefined();

      const todoSection = updatedBoard?.section?.find(s => s.id === "sec-todo");
      const doneSection = updatedBoard?.section?.find(s => s.id === "sec-done");

      // card-1 should no longer be in sec-todo
      expect(todoSection?.issues?.some(i => i.id === "card-1")).toBe(false);
      expect(todoSection?.issues?.length).toBe(1);

      // card-1 should now be in sec-done at position 500
      expect(doneSection?.issues?.some(i => i.id === "card-1")).toBe(true);
      expect(doneSection?.issues?.length).toBe(2);

      const moved = doneSection?.issues?.find(i => i.id === "card-1");
      expect(moved?.sectionId).toBe("sec-done");
      expect(moved?.position).toBe(500);

      // Verify sec-done issues are properly sorted: card-1 (500), card-3 (1000)
      expect(doneSection?.issues?.[0]?.id).toBe("card-1");
      expect(doneSection?.issues?.[1]?.id).toBe("card-3");
    });

    it("optimistically drops a card into an empty column", async () => {
      const moveSpy = mock(() => Promise.resolve({
        id: "card-2",
        sectionId: "sec-empty",
        position: 1000,
        title: "Task 2",
        priority: "high" as const,
        isArchived: false,
        boardId
      }));
      kanbanApi.moveIssue = moveSpy as unknown as typeof kanbanApi.moveIssue;

      await moveCardAsync({
        issueId: "card-2",
        sectionId: "sec-empty",
        position: 1000
      });

      const updatedBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const emptySection = updatedBoard?.section?.find(s => s.id === "sec-empty");

      expect(emptySection?.issues?.length).toBe(1);
      expect(emptySection?.issues?.[0]?.id).toBe("card-2");
      expect(emptySection?.issues?.[0]?.sectionId).toBe("sec-empty");
    });

    it("optimistically reorders a card within the same section", async () => {
      const moveSpy = mock(() => Promise.resolve({
        id: "card-2",
        sectionId: "sec-todo",
        position: 500,
        title: "Task 2",
        priority: "high" as const,
        isArchived: false,
        boardId
      }));
      kanbanApi.moveIssue = moveSpy as unknown as typeof kanbanApi.moveIssue;

      // Move card-2 from pos 2000 to pos 500 (before card-1 at pos 1000)
      await moveCardAsync({
        issueId: "card-2",
        sectionId: "sec-todo",
        position: 500
      });

      const updatedBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const todoSection = updatedBoard?.section?.find(s => s.id === "sec-todo");

      expect(todoSection?.issues?.length).toBe(2);
      expect(todoSection?.issues?.[0]?.id).toBe("card-2");
      expect(todoSection?.issues?.[0]?.position).toBe(500);
      expect(todoSection?.issues?.[1]?.id).toBe("card-1");
      expect(todoSection?.issues?.[1]?.position).toBe(1000);
    });

    it("rolls back cache to previous snapshot when server returns an error", async () => {
      // Simulate server 500 error or network disconnection
      const failSpy = mock(() => Promise.reject(new Error("500 Internal Server Error: Database failure")));
      kanbanApi.moveIssue = failSpy as unknown as typeof kanbanApi.moveIssue;

      try {
        await moveCardAsync({
          issueId: "card-1",
          sectionId: "sec-done",
          position: 500
        });
      } catch {
        // Expected to throw
      }

      // Assert rollback: card-1 must still be in sec-todo and NOT in sec-done!
      const rolledBackBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const todoSection = rolledBackBoard?.section?.find(s => s.id === "sec-todo");
      const doneSection = rolledBackBoard?.section?.find(s => s.id === "sec-done");

      expect(todoSection?.issues?.some(i => i.id === "card-1")).toBe(true);
      expect(todoSection?.issues?.length).toBe(2);
      expect(doneSection?.issues?.some(i => i.id === "card-1")).toBe(false);
      expect(doneSection?.issues?.length).toBe(1);
    });
  });

  describe("2. Column Reorder Optimistic Cache Mutation", () => {
    it("optimistically updates column position and re-sorts sections in cache", async () => {
      const updateSectionSpy = mock(() => Promise.resolve({
        id: "sec-todo",
        title: "To Do",
        position: 2500,
        boardId
      }));
      kanbanApi.updateSection = updateSectionSpy as unknown as typeof kanbanApi.updateSection;

      // Move sec-todo from position 1000 to 2500 (between sec-done at 2000 and sec-empty at 3000)
      await updateSectionAsync({
        sectionId: "sec-todo",
        updates: { position: 2500 }
      });

      const updatedBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const sections = updatedBoard?.section;

      expect(sections?.length).toBe(3);
      // sec-done (2000) should now be first, sec-todo (2500) second, sec-empty (3000) third
      expect(sections?.[0]?.id).toBe("sec-done");
      expect(sections?.[1]?.id).toBe("sec-todo");
      expect(sections?.[1]?.position).toBe(2500);
      expect(sections?.[2]?.id).toBe("sec-empty");
    });

    it("rolls back column order to previous snapshot when column update fails", async () => {
      const failSpy = mock(() => Promise.reject(new Error("403 Forbidden: Insufficient permissions")));
      kanbanApi.updateSection = failSpy as unknown as typeof kanbanApi.updateSection;

      try {
        await updateSectionAsync({
          sectionId: "sec-todo",
          updates: { position: 5000 }
        });
      } catch {
        // Expected
      }

      const rolledBackBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const sections = rolledBackBoard?.section;

      // Should be rolled back to original position (1000) and first index
      expect(sections?.[0]?.id).toBe("sec-todo");
      expect(sections?.[0]?.position).toBe(1000);
      expect(sections?.[1]?.id).toBe("sec-done");
    });
  });
});
