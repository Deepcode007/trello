import React, { useState, useMemo } from "react";
import { Plus, Kanban, AlertCircle, X } from "lucide-react";
import { Button } from "../ui/button";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { CreateColumnModal } from "./CreateColumnModal";
import { BoardFilterBar } from "./BoardFilterBar";
import { useRole } from "../../hooks/useRole";
import { useAuthStore } from "../../store/useAuthStore";
import { useMoveIssueMutation, useUpdateSectionMutation } from "../../hooks/useKanbanQueries";
import { getKanbanErrorMessage } from "../../lib/kanban-api";
import { calculateDropPosition } from "../../lib/dnd-math";
import type { BoardDetail, BoardSection, BoardIssue } from "../../lib/board-api";
import {
  type BoardFilterState,
  DEFAULT_BOARD_FILTERS,
  filterBoardSections,
  extractAvailableLabels,
  extractAvailableAssignees,
  computeFilterSummaryStats
} from "../../lib/board-filters";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates
} from "@dnd-kit/sortable";

export interface KanbanCanvasProps {
  board: BoardDetail;
  onSelectCard?: (issueId: string) => void;
}

export function KanbanCanvas({ board, onSelectCard }: KanbanCanvasProps) {
  const { canEditBoard } = useRole(board.orgId);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [dndError, setDndError] = useState<string | null>(null);

  // Active drag tracking
  const [activeType, setActiveType] = useState<"card" | "column" | null>(null);
  const [activeCard, setActiveCard] = useState<BoardIssue | null>(null);
  const [activeColumn, setActiveColumn] = useState<BoardSection | null>(null);

  const moveIssueMutation = useMoveIssueMutation(board.id);
  const updateSectionMutation = useUpdateSectionMutation(board.id);

  // Sensor configuration: 5px activation distance allows clicks without triggering drags
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5
    }
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Fallback to empty array if section is missing or null
  const sections = useMemo(() => board.section || [], [board.section]);

  // Defensive sorting of columns by position: asc, createdAt: asc, id: asc
  // and issues inside each column by position: asc, createdAt: asc, id: asc
  const sortedSections = useMemo(() => {
    return [...sections]
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        const aCreated = (a as unknown as { createdAt?: string }).createdAt || "";
        const bCreated = (b as unknown as { createdAt?: string }).createdAt || "";
        if (aCreated && bCreated) return aCreated.localeCompare(bCreated);
        return a.id.localeCompare(b.id);
      })
      .map(sec => ({
        ...sec,
        issues: [...(sec.issues || [])].sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          if (a.createdAt && b.createdAt) return a.createdAt.localeCompare(b.createdAt);
          return a.id.localeCompare(b.id);
        })
      }));
  }, [sections]);

  const currentUser = useAuthStore(s => s.user);
  const [filters, setFilters] = useState<BoardFilterState>(DEFAULT_BOARD_FILTERS);

  const availableLabels = useMemo(() => extractAvailableLabels(sections), [sections]);
  const availableAssignees = useMemo(() => extractAvailableAssignees(sections), [sections]);

  const filteredSections = useMemo(
    () => filterBoardSections(sortedSections, filters, currentUser?.id),
    [sortedSections, filters, currentUser?.id]
  );

  const { totalCards, matchingCards } = useMemo(
    () => computeFilterSummaryStats(sortedSections, filteredSections),
    [sortedSections, filteredSections]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current;
    setDndError(null);

    if (data?.type === "card") {
      setActiveType("card");
      setActiveCard(data.issue as BoardIssue);
    } else if (data?.type === "column") {
      setActiveType("column");
      setActiveColumn(data.section as BoardSection);
    }
  };

  const handleDragCancel = () => {
    setActiveType(null);
    setActiveCard(null);
    setActiveColumn(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    // Reset active overlay state
    setActiveType(null);
    setActiveCard(null);
    setActiveColumn(null);

    if (!over || active.id === over.id) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // --- Scenario A: Dragging a Column ---
    if (activeData?.type === "column") {
      const activeColId = String(active.id);
      const overColId = String(over.id);

      const oldIndex = sortedSections.findIndex(s => s.id === activeColId);
      const newIndex = sortedSections.findIndex(s => s.id === overColId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        // Calculate new position using midpoint math
        const targetPos = calculateDropPosition(
          sortedSections,
          newIndex,
          activeColId
        );

        try {
          await updateSectionMutation.mutateAsync({
            sectionId: activeColId,
            updates: { position: targetPos }
          });
        } catch (err: unknown) {
          setDndError(getKanbanErrorMessage(err, "Failed to reorder column"));
        }
      }
      return;
    }

    // --- Scenario B: Dragging a Card ---
    if (activeData?.type === "card") {
      const cardId = String(active.id);
      const overId = String(over.id);

      // Locate the source section containing this card
      const sourceSection = sortedSections.find(sec =>
        sec.issues?.some(iss => iss.id === cardId)
      );
      if (!sourceSection) return;

      let targetSection: BoardSection | undefined;
      let targetIndex = 0;

      if (overData?.type === "column") {
        // Dropped directly on a column container
        targetSection = sortedSections.find(s => s.id === overId);
        if (!targetSection) return;
        const targetIssues = (targetSection.issues || []).filter(i => i.id !== cardId);
        targetIndex = targetIssues.length;
      } else {
        // Dropped over another card
        targetSection = sortedSections.find(sec =>
          sec.issues?.some(iss => iss.id === overId)
        );
        if (!targetSection) return;

        const targetIssues = (targetSection.issues || []).filter(i => i.id !== cardId);
        const overCardIndex = (targetSection.issues || []).findIndex(i => i.id === overId);
        targetIndex = overCardIndex !== -1 ? overCardIndex : targetIssues.length;
      }

      if (!targetSection) return;

      const targetIssues = (targetSection.issues || []).filter(i => i.id !== cardId);
      const isSameSection = sourceSection.id === targetSection.id;
      const oldIndex = (sourceSection.issues || []).findIndex(i => i.id === cardId);

      // Avoid unnecessary mutations if dropped in original place
      if (isSameSection && oldIndex === targetIndex) {
        return;
      }

      // Compute new monotonic floating-point position
      const newPosition = calculateDropPosition(
        targetIssues,
        targetIndex,
        cardId
      );

      try {
        await moveIssueMutation.mutateAsync({
          issueId: cardId,
          sectionId: targetSection.id,
          position: newPosition
        });
      } catch (err: unknown) {
        setDndError(getKanbanErrorMessage(err, "Failed to move card"));
      }
    }
  };

  return (
    <>
      {/* Error notification banner */}
      {dndError && (
        <div
          data-testid="dnd-error-banner"
          className="mx-6 mt-4 p-3 rounded-lg bg-destructive/15 border border-destructive/30 text-destructive text-xs flex items-center justify-between gap-2 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{dndError}</span>
          </div>
          <button
            type="button"
            onClick={() => setDndError(null)}
            className="p-1 hover:bg-destructive/20 rounded transition-colors"
            data-testid="dismiss-dnd-error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Board Filter Bar */}
      {sortedSections.length > 0 && (
        <BoardFilterBar
          filters={filters}
          onFiltersChange={setFilters}
          availableLabels={availableLabels}
          availableAssignees={availableAssignees}
          totalCardsCount={totalCards}
          matchingCardsCount={matchingCards}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <main
          className="flex-1 overflow-x-auto p-4 sm:p-6 flex gap-4 min-h-[500px] bg-secondary/10 touch-pan-x scroll-smooth"
          data-testid="board-canvas-viewport"
          aria-label="Kanban Canvas"
        >
          {sortedSections.length > 0 ? (
            <SortableContext
              items={sortedSections.map(s => s.id)}
              strategy={horizontalListSortingStrategy}
            >
              {filteredSections.map(section => (
                <KanbanColumn
                  key={section.id}
                  section={section}
                  boardId={board.id}
                  orgId={board.orgId}
                  allSections={sortedSections}
                  onSelectCard={onSelectCard}
                />
              ))}

              {/* Add Column Button at the end of canvas */}
              {canEditBoard && (
                <div className="w-[82vw] sm:w-72 shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => setIsCreateModalOpen(true)}
                    className="w-full justify-start h-11 border-dashed border-border/80 bg-card/40 hover:bg-card text-muted-foreground hover:text-foreground gap-2"
                    data-testid="add-column-button"
                  >
                    <Plus className="h-4 w-4" />
                    Add Column
                  </Button>
                </div>
              )}
            </SortableContext>
          ) : (
            <div
              data-testid="canvas-empty-columns"
              className="flex flex-col items-center justify-center m-auto text-center p-8 rounded-xl border border-dashed border-border/80 bg-card/40 max-w-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
                <Kanban className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                Canvas Ready
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                This board has no columns yet. Create your first column to start organizing tasks.
              </p>
              {canEditBoard && (
                <Button
                  onClick={() => setIsCreateModalOpen(true)}
                  size="sm"
                  className="mt-4 gap-1.5"
                  data-testid="create-first-column-button"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Column
                </Button>
              )}
            </div>
          )}
        </main>

        {/* Drag Overlay for smooth card/column dragging */}
        <DragOverlay>
          {activeType === "card" && activeCard && (
            <div className="w-68 pointer-events-none">
              <KanbanCard issue={activeCard} isOverlay />
            </div>
          )}
          {activeType === "column" && activeColumn && (
            <div className="w-[82vw] sm:w-72 pointer-events-none opacity-90 shadow-2xl">
              <KanbanColumn
                section={activeColumn}
                boardId={board.id}
                orgId={board.orgId}
                allSections={sortedSections}
                isOverlay
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Create Column Modal */}
      <CreateColumnModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        boardId={board.id}
        orgId={board.orgId}
      />
    </>
  );
}
