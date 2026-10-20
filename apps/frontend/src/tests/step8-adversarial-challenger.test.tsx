import { describe, it, expect } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  matchesIssueFilters,
  filterBoardSections,
  computeFilterSummaryStats,
  extractAvailableLabels,
  extractAvailableAssignees,
  type BoardFilterState,
  DEFAULT_BOARD_FILTERS
} from "../lib/board-filters";
import { getDueDateUrgency } from "../lib/date-urgency";
import { useThemeStore } from "../store/useThemeStore";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import { KanbanColumn } from "../components/board/KanbanColumn";
import type { BoardIssue, BoardSection } from "../lib/board-api";

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

describe("Step 8 Challenger: Adversarial Stress & Boundary Verification", () => {
  const fixedNow = new Date("2026-10-20T12:00:00.000Z");

  describe("1. Scaling & Layout Invariants: 20 Columns & 200 Cards", () => {
    it("filters across 20 columns and 200 cards in under 15ms maintaining position ordering", () => {
      const largeSections: BoardSection[] = [];
      let globalIssueId = 0;

      for (let c = 0; c < 20; c++) {
        const issues: BoardIssue[] = [];
        for (let i = 0; i < 10; i++) {
          globalIssueId++;
          issues.push({
            id: `card-${globalIssueId}`,
            title: `Task #${globalIssueId} ${globalIssueId % 2 === 0 ? "FEATURE" : "BUG"} in pipeline`,
            description: `Details for task ${globalIssueId}`,
            position: (i + 1) * 1000,
            priority: (["low", "medium", "high", "urgent"] as const)[globalIssueId % 4]!,
            dueDate: globalIssueId % 3 === 0 ? "2026-10-19T00:00:00.000Z" : null,
            isArchived: false,
            boardId: "b-scaling",
            sectionId: `sec-${c}`
          });
        }

        largeSections.push({
          id: `sec-${c}`,
          title: `Column ${c + 1}`,
          position: (c + 1) * 1000,
          isArchived: false,
          issues
        });
      }

      const filters: BoardFilterState = {
        ...DEFAULT_BOARD_FILTERS,
        searchQuery: "feature",
        priority: "low"
      };

      const t0 = performance.now();
      const filtered = filterBoardSections(largeSections, filters, null, fixedNow);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(50); // Well under threshold
      expect(filtered.length).toBe(20);

      const stats = computeFilterSummaryStats(largeSections, filtered);
      expect(stats.totalCards).toBe(200);
      expect(stats.matchingCards).toBeGreaterThan(0);
      expect(stats.matchingCards).toBeLessThan(200);

      // Verify position ordering is strictly preserved in all filtered columns
      for (const col of filtered) {
        if (!col.issues || col.issues.length <= 1) continue;
        for (let i = 0; i < col.issues.length - 1; i++) {
          expect(col.issues[i]!.position).toBeLessThan(col.issues[i + 1]!.position);
        }
      }
    });
  });

  describe("2. Adversarial & Malicious Search Queries", () => {
    const testIssue: BoardIssue = {
      id: "card-xss",
      title: "<script>alert('XSS')</script> Safe Unicode 🚀 Arabic: تجربة",
      description: "Pathological chars: .*+?^${}()|[]\\ and emojis 💻🔥",
      position: 1000,
      priority: "high",
      isArchived: false,
      boardId: "b-1",
      sectionId: "sec-1"
    };

    it("safely handles XSS injections and raw regex metacharacters in searchQuery", () => {
      // Substrings that ARE in the text
      const matchingQueries = [
        "<script>",
        "alert('XSS')",
        ".*",
        ".*+?^${}()|[]\\",
        "🚀",
        "تجربة",
        "💻🔥"
      ];

      for (const q of matchingQueries) {
        const filters: BoardFilterState = {
          ...DEFAULT_BOARD_FILTERS,
          searchQuery: q
        };

        expect(() => matchesIssueFilters(testIssue, filters)).not.toThrow();
        expect(matchesIssueFilters(testIssue, filters)).toBe(true);
      }

      // Malformed regex patterns not in text must safely return false without throwing
      const nonMatchingRegexPatterns = [
        "[a-z]+",
        "(.*)",
        "\\d+",
        "[({\\^$}]",
        "***pathological***"
      ];

      for (const pattern of nonMatchingRegexPatterns) {
        const filters: BoardFilterState = {
          ...DEFAULT_BOARD_FILTERS,
          searchQuery: pattern
        };

        expect(() => matchesIssueFilters(testIssue, filters)).not.toThrow();
        expect(matchesIssueFilters(testIssue, filters)).toBe(false);
      }
    });

    it("trims whitespace and performs case-insensitive comparisons", () => {
      const filters: BoardFilterState = {
        ...DEFAULT_BOARD_FILTERS,
        searchQuery: "   SaFe UnIcOdE   "
      };

      expect(matchesIssueFilters(testIssue, filters)).toBe(true);
    });
  });

  describe("3. Date Urgency Boundary & Calendar Transitions", () => {
    it("handles leap year date boundaries correctly", () => {
      // Leap year: 2028-02-29
      const leapDay = "2028-02-29T12:00:00.000Z";
      const beforeLeapDay = new Date("2028-02-28T12:00:00.000Z");

      const res = getDueDateUrgency(leapDay, beforeLeapDay);
      expect(res.level).toBe("due-soon");
      expect(res.daysRemaining).toBe(1);
      expect(res.label).toBe("Due tomorrow");
    });

    it("handles year-end rollover correctly (Dec 31 to Jan 1)", () => {
      const newYearEve = new Date("2026-12-31T18:00:00.000Z");
      const newYearDay = "2027-01-01T09:00:00.000Z";

      const res = getDueDateUrgency(newYearDay, newYearEve);
      expect(res.level).toBe("due-soon");
      expect(res.daysRemaining).toBe(1);
      expect(res.label).toBe("Due tomorrow");
    });

    it("handles extreme far future and far past dates without NaN or exceptions", () => {
      const ancient = "1970-01-01T00:00:00.000Z";
      const farFuture = "2099-12-31T23:59:59.000Z";

      const resAncient = getDueDateUrgency(ancient, fixedNow);
      expect(resAncient.level).toBe("overdue");
      expect(resAncient.isPastDue).toBe(true);
      expect(Number.isFinite(resAncient.daysRemaining)).toBe(true);

      const resFuture = getDueDateUrgency(farFuture, fixedNow);
      expect(resFuture.level).toBe("normal");
      expect(resFuture.isPastDue).toBe(false);
      expect(Number.isFinite(resFuture.daysRemaining)).toBe(true);
    });
  });

  describe("4. Theme Store Mutation Invariants", () => {
    it("cycles through theme states deterministically", () => {
      useThemeStore.getState().setTheme("light");
      expect(useThemeStore.getState().theme).toBe("light");
      expect(useThemeStore.getState().resolvedTheme).toBe("light");

      useThemeStore.getState().toggleTheme();
      expect(useThemeStore.getState().theme).toBe("dark");
      expect(useThemeStore.getState().resolvedTheme).toBe("dark");

      useThemeStore.getState().toggleTheme();
      expect(useThemeStore.getState().theme).toBe("light");
      expect(useThemeStore.getState().resolvedTheme).toBe("light");

      useThemeStore.getState().setTheme("system");
      expect(useThemeStore.getState().theme).toBe("system");
    });
  });

  describe("5. WIP Limit Persistence Under Filter Conditions", () => {
    it("maintains wip-limit-warning when column exceeds WIP limit even if filtered cards are below limit", () => {
      // Mock auth and org store
      useAuthStore.setState({
        token: "mock-token",
        user: { id: "u-1", email: "user@test.com", username: "user" }
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
              name: "Org 1",
              description: "",
              visible: true,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z"
            }
          }
        ]
      });

      const fullSection: BoardSection = {
        id: "sec-wip",
        title: "In Review",
        position: 1000,
        wipLimit: 2,
        isArchived: false,
        issues: [
          { id: "c1", title: "Task 1", position: 1000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-wip" },
          { id: "c2", title: "Task 2", position: 2000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-wip" },
          { id: "c3", title: "Task 3", position: 3000, priority: "urgent", isArchived: false, boardId: "b-1", sectionId: "sec-wip" },
          { id: "c4", title: "Task 4", position: 4000, priority: "low", isArchived: false, boardId: "b-1", sectionId: "sec-wip" }
        ]
      };

      // When filtered by priority=urgent, only c3 is in filteredSection.issues
      const filteredSection: BoardSection = {
        ...fullSection,
        issues: [fullSection.issues![2]!]
      };

      const html = renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client: createTestQueryClient() },
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(KanbanColumn, {
              section: filteredSection,
              boardId: "b-1",
              orgId: "org-1",
              allSections: [fullSection]
            })
          )
        )
      );

      // Warning MUST remain active because the column contains 4 tasks (exceeding WIP limit of 2)
      expect(html).toContain('data-testid="wip-limit-warning"');
      // The badge displays the filtered / total ratio: 1/4 / 2
      expect(html).toContain("1/4 / 2");
    });
  });

  describe("6. Facet Extractor Malformed Payload Fault Injection", () => {
    it("safely handles null/undefined users, labels, and missing name properties", () => {
      const pathologicalSections: BoardSection[] = [
        {
          id: "sec-malformed",
          title: "Malformed",
          position: 1000,
          isArchived: false,
          issues: [
            {
              id: "c-bad-1",
              title: "Malformed card",
              position: 1000,
              isArchived: false,
              boardId: "b-1",
              sectionId: "sec-malformed",
              // @ts-expect-error fault injection: label without name
              labels: [{ label: { id: "lbl-empty", name: "", color: "" } }, { label: null }],
              // @ts-expect-error fault injection: user with null name/username
              issueMappings: [{ user: { id: "u-empty", name: null, username: null, email: "empty@test.com" } }, { user: null }]
            }
          ]
        }
      ];

      expect(() => extractAvailableLabels(pathologicalSections)).not.toThrow();
      const labels = extractAvailableLabels(pathologicalSections);
      expect(labels.length).toBe(1);
      expect(labels[0]!.name).toBe("Unnamed");

      expect(() => extractAvailableAssignees(pathologicalSections)).not.toThrow();
      const assignees = extractAvailableAssignees(pathologicalSections);
      expect(assignees.length).toBe(1);
      expect(assignees[0]!.email).toBe("empty@test.com");
    });
  });

  describe("7. Due Date Filter Robustness on Date-Only Strings", () => {
    it("reliably matches due-today for YYYY-MM-DD input across morning, noon, and night", () => {
      const issue: BoardIssue = {
        id: "c-due",
        title: "Due today task",
        position: 1000,
        priority: "medium",
        dueDate: "2026-10-20",
        isArchived: false,
        boardId: "b-1",
        sectionId: "sec-1"
      };

      const filter: BoardFilterState = {
        ...DEFAULT_BOARD_FILTERS,
        dueUrgency: "due-today"
      };

      const morning = new Date("2026-10-20T08:30:00.000Z");
      const noon = new Date("2026-10-20T12:00:00.000Z");
      const night = new Date("2026-10-20T22:30:00.000Z");

      expect(matchesIssueFilters(issue, filter, null, morning)).toBe(true);
      expect(matchesIssueFilters(issue, filter, null, noon)).toBe(true);
      expect(matchesIssueFilters(issue, filter, null, night)).toBe(true);
    });
  });
});
