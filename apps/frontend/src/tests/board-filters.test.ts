import { describe, it, expect } from "bun:test";
import {
  matchesIssueFilters,
  filterBoardSections,
  extractAvailableLabels,
  extractAvailableAssignees,
  computeFilterSummaryStats,
  isFilterActive,
  countActiveFilters,
  DEFAULT_BOARD_FILTERS,
  type BoardFilterState
} from "../lib/board-filters";
import type { BoardIssue, BoardSection } from "../lib/board-api";

describe("Step 8: Board Filters & Search Suite", () => {
  const referenceDate = new Date("2026-10-20T12:00:00.000Z");

  const sampleIssues: BoardIssue[] = [
    {
      id: "card-1",
      title: "Fix authentication bug in login flow",
      description: "Users report 401 when token expires",
      position: 1000,
      priority: "urgent",
      dueDate: "2026-10-18T10:00:00.000Z", // overdue
      isArchived: false,
      boardId: "b-1",
      sectionId: "sec-1",
      labels: [{ label: { id: "lbl-bug", name: "Bug", color: "#ef4444" } }],
      issueMappings: [
        { user: { id: "u-alice", name: "Alice", email: "alice@test.com", username: "alice", avatarUrl: null } }
      ]
    },
    {
      id: "card-2",
      title: "Design dark mode palette",
      description: "HSL color variables for Tailwind",
      position: 2000,
      priority: "high",
      dueDate: "2026-10-20T18:00:00.000Z", // due today
      isArchived: false,
      boardId: "b-1",
      sectionId: "sec-1",
      labels: [{ label: { id: "lbl-ui", name: "UI/UX", color: "#3b82f6" } }],
      issueMappings: [
        { user: { id: "u-bob", name: "Bob", email: "bob@test.com", username: "bob", avatarUrl: null } }
      ]
    },
    {
      id: "card-3",
      title: "Implement responsive mobile navigation",
      description: "Add hamburger menu for small viewports",
      position: 3000,
      priority: "medium",
      dueDate: "2026-10-22T12:00:00.000Z", // due soon (2 days)
      isArchived: false,
      boardId: "b-1",
      sectionId: "sec-2",
      labels: [{ label: { id: "lbl-ui", name: "UI/UX", color: "#3b82f6" } }],
      issueMappings: [] // unassigned
    },
    {
      id: "card-4",
      title: "Write documentation for deployment",
      description: "Turborepo build scripts and Docker containerization",
      position: 4000,
      priority: "low",
      dueDate: null, // no due date
      isArchived: false,
      boardId: "b-1",
      sectionId: "sec-2",
      labels: [],
      issueMappings: [
        { user: { id: "u-alice", name: "Alice", email: "alice@test.com", username: "alice", avatarUrl: null } },
        { user: { id: "u-bob", name: "Bob", email: "bob@test.com", username: "bob", avatarUrl: null } }
      ]
    }
  ];

  const sampleSections: BoardSection[] = [
    {
      id: "sec-1",
      title: "To Do",
      position: 1000,
      isArchived: false,
      issues: [sampleIssues[0]!, sampleIssues[1]!]
    },
    {
      id: "sec-2",
      title: "In Progress",
      position: 2000,
      isArchived: false,
      issues: [sampleIssues[2]!, sampleIssues[3]!]
    }
  ];

  describe("isFilterActive & countActiveFilters", () => {
    it("reports inactive with 0 count for default filters", () => {
      expect(isFilterActive(DEFAULT_BOARD_FILTERS)).toBe(false);
      expect(countActiveFilters(DEFAULT_BOARD_FILTERS)).toBe(0);
    });

    it("correctly identifies active filters across each dimension", () => {
      expect(isFilterActive({ ...DEFAULT_BOARD_FILTERS, searchQuery: "bug" })).toBe(true);
      expect(countActiveFilters({ ...DEFAULT_BOARD_FILTERS, searchQuery: "bug" })).toBe(1);

      expect(isFilterActive({ ...DEFAULT_BOARD_FILTERS, priority: "urgent" })).toBe(true);
      expect(countActiveFilters({ ...DEFAULT_BOARD_FILTERS, priority: "urgent" })).toBe(1);

      expect(isFilterActive({ ...DEFAULT_BOARD_FILTERS, assigneeId: "me" })).toBe(true);
      expect(countActiveFilters({ ...DEFAULT_BOARD_FILTERS, assigneeId: "me" })).toBe(1);

      expect(isFilterActive({ ...DEFAULT_BOARD_FILTERS, labelId: "lbl-bug" })).toBe(true);
      expect(countActiveFilters({ ...DEFAULT_BOARD_FILTERS, labelId: "lbl-bug" })).toBe(1);

      expect(isFilterActive({ ...DEFAULT_BOARD_FILTERS, dueUrgency: "overdue" })).toBe(true);
      expect(countActiveFilters({ ...DEFAULT_BOARD_FILTERS, dueUrgency: "overdue" })).toBe(1);

      // Multiple combined
      const allActive: BoardFilterState = {
        searchQuery: "auth",
        priority: "urgent",
        assigneeId: "u-alice",
        labelId: "lbl-bug",
        dueUrgency: "overdue"
      };
      expect(isFilterActive(allActive)).toBe(true);
      expect(countActiveFilters(allActive)).toBe(5);
    });
  });

  describe("matchesIssueFilters", () => {
    it("matches all issues under default filters", () => {
      for (const issue of sampleIssues) {
        expect(matchesIssueFilters(issue, DEFAULT_BOARD_FILTERS, "u-alice", referenceDate)).toBe(true);
      }
    });

    it("filters case-insensitively by title substring", () => {
      const filters: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, searchQuery: "DARK MODE" };
      expect(matchesIssueFilters(sampleIssues[1]!, filters)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[0]!, filters)).toBe(false);
    });

    it("filters case-insensitively by description substring", () => {
      const filters: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, searchQuery: "turborepo" };
      expect(matchesIssueFilters(sampleIssues[3]!, filters)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[0]!, filters)).toBe(false);
    });

    it("safely handles special regex characters in query without crashing", () => {
      const specialQuery = "[.*+?^${}()|]";
      const filters: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, searchQuery: specialQuery };
      // Should not throw SyntaxError
      expect(matchesIssueFilters(sampleIssues[0]!, filters)).toBe(false);
    });

    it("filters strictly by priority", () => {
      const filtersUrgent: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, priority: "urgent" };
      expect(matchesIssueFilters(sampleIssues[0]!, filtersUrgent)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[1]!, filtersUrgent)).toBe(false);

      const filtersLow: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, priority: "low" };
      expect(matchesIssueFilters(sampleIssues[3]!, filtersLow)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[0]!, filtersLow)).toBe(false);
    });

    it("filters by assigned to me ('me')", () => {
      const filtersMe: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, assigneeId: "me" };
      // Alice is assigned to card-1 and card-4
      expect(matchesIssueFilters(sampleIssues[0]!, filtersMe, "u-alice")).toBe(true);
      expect(matchesIssueFilters(sampleIssues[1]!, filtersMe, "u-alice")).toBe(false);
      expect(matchesIssueFilters(sampleIssues[2]!, filtersMe, "u-alice")).toBe(false);
      expect(matchesIssueFilters(sampleIssues[3]!, filtersMe, "u-alice")).toBe(true);
    });

    it("filters by unassigned issues", () => {
      const filtersUnassigned: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, assigneeId: "unassigned" };
      // card-3 has empty issueMappings
      expect(matchesIssueFilters(sampleIssues[0]!, filtersUnassigned)).toBe(false);
      expect(matchesIssueFilters(sampleIssues[2]!, filtersUnassigned)).toBe(true);
    });

    it("filters by specific assignee ID", () => {
      const filtersBob: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, assigneeId: "u-bob" };
      expect(matchesIssueFilters(sampleIssues[0]!, filtersBob)).toBe(false);
      expect(matchesIssueFilters(sampleIssues[1]!, filtersBob)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[3]!, filtersBob)).toBe(true);
    });

    it("filters by label ID", () => {
      const filtersBug: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, labelId: "lbl-bug" };
      expect(matchesIssueFilters(sampleIssues[0]!, filtersBug)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[1]!, filtersBug)).toBe(false);

      const filtersUi: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, labelId: "lbl-ui" };
      expect(matchesIssueFilters(sampleIssues[1]!, filtersUi)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[2]!, filtersUi)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[0]!, filtersUi)).toBe(false);
    });

    it("filters by due date urgency: overdue", () => {
      const filtersOverdue: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, dueUrgency: "overdue" };
      expect(matchesIssueFilters(sampleIssues[0]!, filtersOverdue, null, referenceDate)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[1]!, filtersOverdue, null, referenceDate)).toBe(false);
    });

    it("filters by due date urgency: due-today", () => {
      const filtersToday: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, dueUrgency: "due-today" };
      expect(matchesIssueFilters(sampleIssues[1]!, filtersToday, null, referenceDate)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[0]!, filtersToday, null, referenceDate)).toBe(false);
    });

    it("filters by due date presence: has-due-date and no-due-date", () => {
      const filtersHasDue: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, dueUrgency: "has-due-date" };
      expect(matchesIssueFilters(sampleIssues[0]!, filtersHasDue)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[3]!, filtersHasDue)).toBe(false);

      const filtersNoDue: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, dueUrgency: "no-due-date" };
      expect(matchesIssueFilters(sampleIssues[3]!, filtersNoDue)).toBe(true);
      expect(matchesIssueFilters(sampleIssues[0]!, filtersNoDue)).toBe(false);
    });

    it("matches combined multi-criteria filters correctly", () => {
      const filters: BoardFilterState = {
        searchQuery: "flow",
        priority: "urgent",
        assigneeId: "u-alice",
        labelId: "lbl-bug",
        dueUrgency: "overdue"
      };

      // card-1 matches all 5 criteria
      expect(matchesIssueFilters(sampleIssues[0]!, filters, "u-alice", referenceDate)).toBe(true);

      // card-2 fails search, priority, label, and due date
      expect(matchesIssueFilters(sampleIssues[1]!, filters, "u-alice", referenceDate)).toBe(false);
    });
  });

  describe("filterBoardSections", () => {
    it("returns original sections when filters are default / inactive", () => {
      const result = filterBoardSections(sampleSections, DEFAULT_BOARD_FILTERS);
      expect(result).toBe(sampleSections);
    });

    it("returns filtered sections preserving column structure and positions", () => {
      const filters: BoardFilterState = { ...DEFAULT_BOARD_FILTERS, labelId: "lbl-bug" };
      const result = filterBoardSections(sampleSections, filters);

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe("sec-1");
      expect(result[0]!.issues?.length).toBe(1);
      expect(result[0]!.issues?.[0]?.id).toBe("card-1");

      // sec-2 has 0 bug issues
      expect(result[1]!.id).toBe("sec-2");
      expect(result[1]!.issues?.length).toBe(0);
    });
  });

  describe("extractAvailableLabels & extractAvailableAssignees", () => {
    it("deduplicates labels across all issues and sorts by name", () => {
      const labels = extractAvailableLabels(sampleSections);
      expect(labels.length).toBe(2);
      expect(labels[0]!.id).toBe("lbl-bug");
      expect(labels[0]!.name).toBe("Bug");
      expect(labels[1]!.id).toBe("lbl-ui");
      expect(labels[1]!.name).toBe("UI/UX");
    });

    it("deduplicates assignees across all issues and sorts by name", () => {
      const assignees = extractAvailableAssignees(sampleSections);
      expect(assignees.length).toBe(2);
      const names = assignees.map(a => a.name);
      expect(names).toContain("Alice");
      expect(names).toContain("Bob");
    });
  });

  describe("computeFilterSummaryStats", () => {
    it("calculates accurate total and matching card metrics", () => {
      const filtered = filterBoardSections(sampleSections, {
        ...DEFAULT_BOARD_FILTERS,
        priority: "urgent"
      });

      const stats = computeFilterSummaryStats(sampleSections, filtered);
      expect(stats.totalCards).toBe(4);
      expect(stats.matchingCards).toBe(1);
      expect(stats.hasFilters).toBe(true);
    });
  });
});
