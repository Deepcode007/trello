import React, { useState } from "react";
import {
  Search,
  X,
  Filter,
  RotateCcw
} from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { BoardFilterState, DueDateFilterOption } from "../../lib/board-filters";
import {
  isFilterActive,
  countActiveFilters,
  DEFAULT_BOARD_FILTERS
} from "../../lib/board-filters";
import type { Priority } from "../../lib/kanban-api";
import { useAuthStore } from "../../store/useAuthStore";

export interface BoardFilterBarProps {
  filters: BoardFilterState;
  onFiltersChange: (newFilters: BoardFilterState) => void;
  availableLabels?: Array<{ id: string; name: string; color: string }>;
  availableAssignees?: Array<{ id: string; name: string; email: string; avatarUrl?: string | null }>;
  totalCardsCount: number;
  matchingCardsCount: number;
}

export function BoardFilterBar({
  filters,
  onFiltersChange,
  availableLabels = [],
  availableAssignees = [],
  totalCardsCount,
  matchingCardsCount
}: BoardFilterBarProps) {
  const currentUser = useAuthStore(s => s.user);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const activeCount = countActiveFilters(filters);
  const hasActive = isFilterActive(filters);

  const handleSearchChange = (query: string) => {
    onFiltersChange({ ...filters, searchQuery: query });
  };

  const handlePriorityChange = (priority: "all" | Priority) => {
    onFiltersChange({ ...filters, priority });
  };

  const handleAssigneeChange = (assigneeId: string) => {
    onFiltersChange({ ...filters, assigneeId });
  };

  const handleLabelChange = (labelId: string) => {
    onFiltersChange({ ...filters, labelId });
  };

  const handleDueUrgencyChange = (dueUrgency: DueDateFilterOption) => {
    onFiltersChange({ ...filters, dueUrgency });
  };

  const handleClearAll = () => {
    onFiltersChange(DEFAULT_BOARD_FILTERS);
  };

  return (
    <div
      className="border-b bg-card/40 backdrop-blur px-6 py-2.5 shadow-2xs"
      data-testid="board-filter-bar"
      aria-label="Board Filters and Search"
    >
      <div className="flex flex-col gap-2.5">
        {/* Main Toolbar Row */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left Side: Search Input & Mobile Filter Toggle */}
          <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Search cards by title or description..."
                value={filters.searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                data-testid="card-search-input"
                className="h-8 pl-8 pr-8 text-xs bg-background/80"
              />
              {filters.searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearchChange("")}
                  data-testid="clear-search-button"
                  aria-label="Clear search input"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Mobile Filter Toggle Button */}
            <Button
              variant={hasActive ? "default" : "outline"}
              size="sm"
              onClick={() => setMobileExpanded(prev => !prev)}
              data-testid="mobile-filter-toggle"
              className="h-8 px-2.5 gap-1.5 text-xs md:hidden shrink-0"
              aria-label="Toggle filter controls"
              aria-expanded={mobileExpanded}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Filters</span>
              {activeCount > 0 && (
                <span
                  data-testid="mobile-active-filters-count"
                  className="ml-0.5 rounded-full bg-primary-foreground text-primary font-bold px-1.5 py-0 text-[10px]"
                >
                  {activeCount}
                </span>
              )}
            </Button>
          </div>

          {/* Desktop Filter Dropdowns */}
          <div className="hidden md:flex flex-wrap items-center gap-2">
            {/* Priority Filter */}
            <select
              value={filters.priority}
              onChange={e => handlePriorityChange(e.target.value as "all" | Priority)}
              data-testid="filter-priority-select"
              aria-label="Filter by priority"
              className="h-8 rounded-md border border-input bg-background/90 px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Assignee Filter */}
            <select
              value={filters.assigneeId}
              onChange={e => handleAssigneeChange(e.target.value)}
              data-testid="filter-assignee-select"
              aria-label="Filter by assignee"
              className="h-8 rounded-md border border-input bg-background/90 px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Assignees</option>
              {currentUser && <option value="me">Assigned to me</option>}
              <option value="unassigned">Unassigned</option>
              {availableAssignees.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            {/* Label Filter */}
            {availableLabels.length > 0 && (
              <select
                value={filters.labelId}
                onChange={e => handleLabelChange(e.target.value)}
                data-testid="filter-label-select"
                aria-label="Filter by label"
                className="h-8 rounded-md border border-input bg-background/90 px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Labels</option>
                {availableLabels.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}

            {/* Due Date Urgency Filter */}
            <select
              value={filters.dueUrgency}
              onChange={e => handleDueUrgencyChange(e.target.value as DueDateFilterOption)}
              data-testid="filter-due-date-select"
              aria-label="Filter by due date"
              className="h-8 rounded-md border border-input bg-background/90 px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Due Dates</option>
              <option value="overdue">Overdue</option>
              <option value="due-today">Due Today</option>
              <option value="due-soon">Due Soon (≤ 3d)</option>
              <option value="has-due-date">Has Due Date</option>
              <option value="no-due-date">No Due Date</option>
            </select>

            {/* Clear All Filters Button */}
            {hasActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                data-testid="clear-all-filters-button"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset</span>
                <Badge
                  variant="secondary"
                  data-testid="active-filters-count"
                  className="ml-1 px-1.5 py-0 text-[10px] h-4"
                >
                  {activeCount}
                </Badge>
              </Button>
            )}
          </div>

          {/* Results Summary Counter */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
            {hasActive ? (
              <span
                data-testid="filter-results-summary"
                className="font-medium text-primary text-[11px]"
              >
                Showing {matchingCardsCount} of {totalCardsCount} cards
              </span>
            ) : (
              <span
                data-testid="total-cards-summary"
                className="text-[11px]"
              >
                {totalCardsCount} {totalCardsCount === 1 ? "card" : "cards"}
              </span>
            )}
          </div>
        </div>

        {/* Collapsible Filter Panel on Mobile Screens */}
        {mobileExpanded && (
          <div
            className="md:hidden pt-2 border-t border-border/40 grid grid-cols-2 gap-2 animate-in fade-in-50"
            data-testid="mobile-filters-panel"
          >
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Priority</label>
              <select
                value={filters.priority}
                onChange={e => handlePriorityChange(e.target.value as "all" | Priority)}
                data-testid="mobile-filter-priority-select"
                className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-medium"
              >
                <option value="all">All Priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Assignee</label>
              <select
                value={filters.assigneeId}
                onChange={e => handleAssigneeChange(e.target.value)}
                data-testid="mobile-filter-assignee-select"
                className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-medium"
              >
                <option value="all">All Assignees</option>
                {currentUser && <option value="me">Assigned to me</option>}
                <option value="unassigned">Unassigned</option>
                {availableAssignees.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            {availableLabels.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">Label</label>
                <select
                  value={filters.labelId}
                  onChange={e => handleLabelChange(e.target.value)}
                  data-testid="mobile-filter-label-select"
                  className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-medium"
                >
                  <option value="all">All Labels</option>
                  {availableLabels.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Due Date</label>
              <select
                value={filters.dueUrgency}
                onChange={e => handleDueUrgencyChange(e.target.value as DueDateFilterOption)}
                data-testid="mobile-filter-due-date-select"
                className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-medium"
              >
                <option value="all">All Due Dates</option>
                <option value="overdue">Overdue</option>
                <option value="due-today">Due Today</option>
                <option value="due-soon">Due Soon (≤ 3d)</option>
                <option value="has-due-date">Has Due Date</option>
                <option value="no-due-date">No Due Date</option>
              </select>
            </div>

            {hasActive && (
              <div className="col-span-2 pt-1 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAll}
                  data-testid="mobile-clear-all-filters"
                  className="h-7 text-xs text-destructive gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset all filters ({activeCount})
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
