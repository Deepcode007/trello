import React, { useState } from "react";
import { Plus, Kanban } from "lucide-react";
import { Button } from "../ui/button";
import { KanbanColumn } from "./KanbanColumn";
import { CreateColumnModal } from "./CreateColumnModal";
import { useRole } from "../../hooks/useRole";
import type { BoardDetail, BoardSection } from "../../lib/board-api";

export interface KanbanCanvasProps {
  board: BoardDetail;
  onSelectCard?: (issueId: string) => void;
}

export function KanbanCanvas({ board, onSelectCard }: KanbanCanvasProps) {
  const { canEditBoard } = useRole(board.orgId);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Fallback to empty array if section is missing or null
  const sections = board.section || [];

  // Defensive sorting of columns by position: asc, createdAt: asc, id: asc
  const sortedSections = [...sections].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    const aCreated = (a as unknown as { createdAt?: string }).createdAt || "";
    const bCreated = (b as unknown as { createdAt?: string }).createdAt || "";
    if (aCreated && bCreated) return aCreated.localeCompare(bCreated);
    return a.id.localeCompare(b.id);
  });

  return (
    <>
      <main
        className="flex-1 overflow-x-auto p-6 flex gap-4 min-h-[500px] bg-secondary/10"
        data-testid="board-canvas-viewport"
        aria-label="Kanban Canvas"
      >
        {sortedSections.length > 0 ? (
          <>
            {sortedSections.map(section => (
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
              <div className="w-72 shrink-0">
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
          </>
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
