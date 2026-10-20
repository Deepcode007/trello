/**
 * Board search, issue filtering, and facet indexing utilities.
 * Supports multi-criteria filtering across search text, priority, assignee, labels, and due date urgency.
 */

import type { BoardIssue, BoardSection } from "./board-api";
import { getDueDateUrgency } from "./date-urgency";

export type DueDateFilterOption =
  | "all"
  | "overdue"
  | "due-today"
  | "due-soon"
  | "has-due-date"
  | "no-due-date";

export interface BoardFilterState {
  searchQuery: string;
  priority: "all" | "low" | "medium" | "high" | "urgent";
  assigneeId: "all" | "me" | "unassigned" | string;
  labelId: "all" | string;
  dueUrgency: DueDateFilterOption;
}

export const DEFAULT_BOARD_FILTERS: BoardFilterState = {
  searchQuery: "",
  priority: "all",
  assigneeId: "all",
  labelId: "all",
  dueUrgency: "all"
};

/**
 * Checks if any filter dimension is actively differing from the default state.
 */
export function isFilterActive(filters: BoardFilterState): boolean {
  return (
    filters.searchQuery.trim().length > 0 ||
    filters.priority !== "all" ||
    filters.assigneeId !== "all" ||
    filters.labelId !== "all" ||
    filters.dueUrgency !== "all"
  );
}

/**
 * Counts the number of active filtering criteria applied (0 to 5).
 */
export function countActiveFilters(filters: BoardFilterState): number {
  let count = 0;
  if (filters.searchQuery.trim().length > 0) count++;
  if (filters.priority !== "all") count++;
  if (filters.assigneeId !== "all") count++;
  if (filters.labelId !== "all") count++;
  if (filters.dueUrgency !== "all") count++;
  return count;
}

/**
 * Determines whether a single issue satisfies the specified filter state.
 */
export function matchesIssueFilters(
  issue: BoardIssue,
  filters: BoardFilterState,
  currentUserId?: string | null,
  referenceDate?: Date
): boolean {
  // 1. Text Search Filter (matches title or description case-insensitively)
  const trimmedSearch = filters.searchQuery.trim().toLowerCase();
  if (trimmedSearch.length > 0) {
    const titleMatch = (issue.title || "").toLowerCase().includes(trimmedSearch);
    const descMatch = (issue.description || "").toLowerCase().includes(trimmedSearch);
    if (!titleMatch && !descMatch) {
      return false;
    }
  }

  // 2. Priority Filter
  if (filters.priority !== "all") {
    if (issue.priority !== filters.priority) {
      return false;
    }
  }

  // 3. Assignee Filter
  if (filters.assigneeId !== "all") {
    const mappings = issue.issueMappings || [];
    if (filters.assigneeId === "unassigned") {
      if (mappings.length > 0) return false;
    } else if (filters.assigneeId === "me") {
      if (!currentUserId) return false;
      const isAssignedToMe = mappings.some(m => m.user?.id === currentUserId);
      if (!isAssignedToMe) return false;
    } else {
      const isAssigned = mappings.some(m => m.user?.id === filters.assigneeId);
      if (!isAssigned) return false;
    }
  }

  // 4. Label Filter
  if (filters.labelId !== "all") {
    const labels = issue.labels || [];
    const hasLabel = labels.some(l => l.label?.id === filters.labelId);
    if (!hasLabel) return false;
  }

  // 5. Due Date Urgency Filter
  if (filters.dueUrgency !== "all") {
    const urgency = getDueDateUrgency(issue.dueDate, referenceDate);
    switch (filters.dueUrgency) {
      case "has-due-date":
        if (!issue.dueDate) return false;
        break;
      case "no-due-date":
        if (issue.dueDate) return false;
        break;
      case "overdue":
        if (urgency.level !== "overdue" && !urgency.isPastDue) return false;
        break;
      case "due-today":
        if (urgency.level !== "due-today" && !urgency.isDueToday) return false;
        break;
      case "due-soon":
        if (urgency.level !== "due-soon" && !urgency.isDueSoon) return false;
        break;
      default:
        break;
    }
  }

  return true;
}

/**
 * Clones board sections and filters issues inside each column based on active filters.
 */
export function filterBoardSections(
  sections: BoardSection[],
  filters: BoardFilterState,
  currentUserId?: string | null,
  referenceDate?: Date
): BoardSection[] {
  if (!isFilterActive(filters)) {
    return sections;
  }

  return sections.map(section => {
    const issues = section.issues || [];
    const filteredIssues = issues.filter(issue =>
      matchesIssueFilters(issue, filters, currentUserId, referenceDate)
    );
    return {
      ...section,
      issues: filteredIssues
    };
  });
}

/**
 * Extracts a deduplicated list of all labels attached to issues on the board.
 */
export function extractAvailableLabels(
  sections: BoardSection[]
): Array<{ id: string; name: string; color: string }> {
  const labelMap = new Map<string, { id: string; name: string; color: string }>();

  for (const section of sections) {
    if (!section.issues) continue;
    for (const issue of section.issues) {
      if (!issue.labels) continue;
      for (const item of issue.labels) {
        if (item.label && !labelMap.has(item.label.id)) {
          labelMap.set(item.label.id, {
            id: item.label.id,
            name: item.label.name || "Unnamed",
            color: item.label.color || "#6b7280"
          });
        }
      }
    }
  }

  return Array.from(labelMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/**
 * Extracts a deduplicated list of all assignees assigned to issues on the board.
 */
export function extractAvailableAssignees(
  sections: BoardSection[]
): Array<{ id: string; name: string; email: string; avatarUrl?: string | null }> {
  const userMap = new Map<string, { id: string; name: string; email: string; avatarUrl?: string | null }>();

  for (const section of sections) {
    if (!section.issues) continue;
    for (const issue of section.issues) {
      if (!issue.issueMappings) continue;
      for (const mapping of issue.issueMappings) {
        if (mapping.user && !userMap.has(mapping.user.id)) {
          userMap.set(mapping.user.id, {
            id: mapping.user.id,
            name: mapping.user.name || mapping.user.username || mapping.user.email || "Unknown",
            email: mapping.user.email || "",
            avatarUrl: mapping.user.avatarUrl
          });
        }
      }
    }
  }

  return Array.from(userMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/**
 * Calculates card count statistics comparing raw board sections with filtered sections.
 */
export function computeFilterSummaryStats(
  allSections: BoardSection[],
  filteredSections: BoardSection[]
): {
  totalCards: number;
  matchingCards: number;
  hasFilters: boolean;
} {
  let totalCards = 0;
  for (const s of allSections) {
    totalCards += s.issues?.length ?? 0;
  }

  let matchingCards = 0;
  for (const s of filteredSections) {
    matchingCards += s.issues?.length ?? 0;
  }

  return {
    totalCards,
    matchingCards,
    hasFilters: totalCards !== matchingCards
  };
}
