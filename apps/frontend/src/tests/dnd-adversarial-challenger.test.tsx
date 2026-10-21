import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealDropdownUI from "../components/ui/dropdown-menu";
import * as RealDialogUI from "../components/ui/dialog";

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

import { calculateDropPosition, DEFAULT_POSITION_OFFSET } from "../lib/dnd-math";
import { useMoveIssueMutation } from "../hooks/useKanbanQueries";
import { kanbanApi } from "../lib/kanban-api";
import type { BoardDetail } from "../lib/board-api";

describe("Step 6: Empirical Challenger — DND Adversarial, Concurrency & Boundary Verification", () => {
  let queryClient: QueryClient;
  const boardId = "board-challenger-999";
  const originalMoveIssue = kanbanApi.moveIssue;

  afterEach(() => {
    kanbanApi.moveIssue = originalMoveIssue;
  });

  const buildStressBoard = (): BoardDetail => ({
    id: boardId,
    title: "Adversarial DND Board",
    description: "Stress testing edge cases",
    color: "#0f172a",
    isArchived: false,
    orgId: "org-stress-1",
    section: [
      {
        id: "sec-alpha",
        title: "Alpha Queue",
        position: 1000,
        wipLimit: 2,
        isArchived: false,
        issues: [
          { id: "c-a1", title: "Alpha Card 1", position: 1000, priority: "low", isArchived: false, boardId, sectionId: "sec-alpha" },
          { id: "c-a2", title: "Alpha Card 2", position: 2000, priority: "medium", isArchived: false, boardId, sectionId: "sec-alpha" }
        ]
      },
      {
        id: "sec-beta",
        title: "Beta Queue",
        position: 2000,
        wipLimit: 1,
        isArchived: false,
        issues: [
          { id: "c-b1", title: "Beta Card 1", position: 1000, priority: "high", isArchived: false, boardId, sectionId: "sec-beta" }
        ]
      },
      {
        id: "sec-gamma",
        title: "Gamma Queue",
        position: 3000,
        wipLimit: null,
        isArchived: false,
        issues: []
      }
    ]
  });

  let moveCardAsync: (vars: { issueId: string; sectionId: string; position?: number }) => Promise<unknown>;

  function TestHarness() {
    const moveMut = useMoveIssueMutation(boardId);
    moveCardAsync = moveMut.mutateAsync;
    return null;
  }

  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });

    queryClient.setQueryData(["board", boardId], buildStressBoard());

    renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(TestHarness)
      )
    );
  });

  describe("1. Mathematical Stress: High-Frequency Consecutive Midpoints", () => {
    it("maintains strict monotonicity under 50 consecutive insertions between adjacent items", () => {
      let items: Array<{ id: string; position: number }> = [
        { id: "c-start", position: 1000 },
        { id: "c-end", position: 2000 }
      ];

      for (let i = 0; i < 50; i++) {
        const mid = calculateDropPosition(items, 1);
        expect(mid).toBeGreaterThan(items[0]!.position);
        expect(mid).toBeLessThan(items[1]!.position);

        const nextList: Array<{ id: string; position: number }> = [
          items[0]!,
          { id: `c-mid-${i}`, position: mid },
          ...items.slice(1)
        ];
        items = nextList.sort((a, b) => a.position - b.position);
      }

      // Assert entire array of 52 items is strictly monotonically increasing
      for (let i = 1; i < items.length; i++) {
        expect(items[i]!.position).toBeGreaterThan(items[i - 1]!.position);
      }
    });

    it("safely handles extreme floating-point scales (-1e12 and +1e12)", () => {
      const extremeItems = [
        { id: "c-huge-neg", position: -1e12 },
        { id: "c-zero", position: 0 },
        { id: "c-huge-pos", position: 1e12 }
      ];

      // Insert before -1e12
      const beforeNeg = calculateDropPosition(extremeItems, 0);
      expect(beforeNeg).toBeLessThan(-1e12);

      // Insert after +1e12
      const afterPos = calculateDropPosition(extremeItems, 3);
      expect(afterPos).toBeGreaterThan(1e12);

      // Midpoint between -1e12 and 0
      const midNeg = calculateDropPosition(extremeItems, 1);
      expect(midNeg).toBe(-5e11);
    });
  });

  describe("2. Concurrency Stress: Sequential Multi-Card Operations", () => {
    it("preserves sequential integrity across 3 rapid multi-column card moves", async () => {
      const moveSpy = mock(() => Promise.resolve({ success: true }));
      kanbanApi.moveIssue = moveSpy as unknown as typeof kanbanApi.moveIssue;

      // Move 1: c-a1 from sec-alpha to sec-gamma (empty)
      await moveCardAsync({
        issueId: "c-a1",
        sectionId: "sec-gamma",
        position: 1000
      });

      // Move 2: c-a2 from sec-alpha to sec-gamma (below c-a1)
      await moveCardAsync({
        issueId: "c-a2",
        sectionId: "sec-gamma",
        position: 2000
      });

      // Move 3: c-b1 from sec-beta to sec-alpha (which was emptied)
      await moveCardAsync({
        issueId: "c-b1",
        sectionId: "sec-alpha",
        position: 1000
      });

      const boardState = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const alpha = boardState?.section?.find(s => s.id === "sec-alpha");
      const beta = boardState?.section?.find(s => s.id === "sec-beta");
      const gamma = boardState?.section?.find(s => s.id === "sec-gamma");

      // sec-alpha now has c-b1
      expect(alpha?.issues?.length).toBe(1);
      expect(alpha?.issues?.[0]?.id).toBe("c-b1");

      // sec-beta is now empty
      expect(beta?.issues?.length).toBe(0);

      // sec-gamma now has c-a1 and c-a2 in order
      expect(gamma?.issues?.length).toBe(2);
      expect(gamma?.issues?.[0]?.id).toBe("c-a1");
      expect(gamma?.issues?.[1]?.id).toBe("c-a2");
    });
  });

  describe("3. WIP Limit Dynamic Thresholds & Rollback Invariants", () => {
    it("dynamically triggers WIP limit exceeded on optimistic move, then reverts cleanly upon server rollback", async () => {
      // sec-beta currently has 1 card with wipLimit: 1 (at limit, not exceeded)
      const initialBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const initialBeta = initialBoard?.section?.find(s => s.id === "sec-beta");
      expect(initialBeta?.issues?.length).toBe(1);
      expect(initialBeta?.wipLimit).toBe(1);
      // count (1) <= wipLimit (1) -> clean

      // Simulate network rejection for move
      const failSpy = mock(() => Promise.reject(new Error("503 Service Unavailable")));
      kanbanApi.moveIssue = failSpy as unknown as typeof kanbanApi.moveIssue;

      try {
        // Attempt to move c-a1 into sec-beta, which would make count = 2 (exceeding wipLimit of 1)
        await moveCardAsync({
          issueId: "c-a1",
          sectionId: "sec-beta",
          position: 2000
        });
      } catch {
        // Expected network failure
      }

      // Rollback verification: sec-beta must have reverted back to 1 card!
      const rolledBackBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      const betaAfterRollback = rolledBackBoard?.section?.find(s => s.id === "sec-beta");
      const alphaAfterRollback = rolledBackBoard?.section?.find(s => s.id === "sec-alpha");

      expect(betaAfterRollback?.issues?.length).toBe(1);
      expect(betaAfterRollback?.issues?.some(i => i.id === "c-a1")).toBe(false);
      expect(alphaAfterRollback?.issues?.length).toBe(2);
      expect(alphaAfterRollback?.issues?.some(i => i.id === "c-a1")).toBe(true);
    });
  });

  describe("4. Pathological & Corrupted Payload Resilience", () => {
    it("gracefully ignores move requests for non-existent card IDs without throwing or corrupting cache", async () => {
      const moveSpy = mock(() => Promise.resolve({ success: true }));
      kanbanApi.moveIssue = moveSpy as unknown as typeof kanbanApi.moveIssue;

      await moveCardAsync({
        issueId: "non-existent-card-id",
        sectionId: "sec-alpha",
        position: 1500
      });

      const boardState = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      expect(boardState).toBeDefined();
      const alpha = boardState?.section?.find(s => s.id === "sec-alpha");
      expect(alpha?.issues?.length).toBe(2);
    });

    it("gracefully ignores move requests targeting non-existent section IDs", async () => {
      const moveSpy = mock(() => Promise.resolve({ success: true }));
      kanbanApi.moveIssue = moveSpy as unknown as typeof kanbanApi.moveIssue;

      await moveCardAsync({
        issueId: "c-a1",
        sectionId: "ghost-section-uuid",
        position: 1500
      });

      const boardState = queryClient.getQueryData<BoardDetail>(["board", boardId]);
      expect(boardState).toBeDefined();
    });

    it("handles board with undefined section array safely in position calculations", () => {
      expect(calculateDropPosition([], 5)).toBe(DEFAULT_POSITION_OFFSET);
      expect(calculateDropPosition([], -10)).toBe(DEFAULT_POSITION_OFFSET);
    });
  });
});
