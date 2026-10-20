import { describe, it, expect, beforeEach } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  applyCardMoved,
  applyCardCreated,
  applyCardUpdated,
  applyCardDeleted,
  applyListCreated,
  applyListUpdated,
  applyListReordered,
  applyListDeleted,
  applyBoardUpdated
} from "../hooks/useBoardSocket";
import type { BoardDetail, BoardIssue, BoardSection } from "../lib/board-api";

function createMockBoard(): BoardDetail {
  return {
    id: "board-test-1",
    title: "Project Alpha",
    description: "Original Description",
    color: "#3b82f6",
    isArchived: false,
    orgId: "org-test-1",
    section: [
      {
        id: "sec-1",
        title: "Backlog",
        position: 1000,
        isArchived: false,
        issues: [
          {
            id: "card-1",
            title: "Task 1",
            position: 1000,
            priority: "low",
            isArchived: false,
            boardId: "board-test-1",
            sectionId: "sec-1"
          },
          {
            id: "card-2",
            title: "Task 2",
            position: 2000,
            priority: "medium",
            isArchived: false,
            boardId: "board-test-1",
            sectionId: "sec-1"
          }
        ]
      },
      {
        id: "sec-2",
        title: "In Progress",
        position: 2000,
        isArchived: false,
        issues: [
          {
            id: "card-3",
            title: "Task 3",
            position: 1000,
            priority: "high",
            isArchived: false,
            boardId: "board-test-1",
            sectionId: "sec-2"
          }
        ]
      }
    ]
  };
}

describe("Step 7 Event Reducer: Synchronous In-Memory Cache Transformation", () => {
  let board: BoardDetail;

  beforeEach(() => {
    board = createMockBoard();
  });

  describe("1. Card Event Reducers", () => {
    it("moves a card across sections and resorts issues by position", () => {
      const updated = applyCardMoved(board, {
        cardId: "card-1",
        sourceList: "sec-1",
        destList: "sec-2",
        position: 3000
      });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      const sec2 = updated.section?.find(s => s.id === "sec-2");

      expect(sec1?.issues?.some(i => i.id === "card-1")).toBe(false);
      expect(sec2?.issues?.some(i => i.id === "card-1")).toBe(true);

      const movedCard = sec2?.issues?.find(i => i.id === "card-1");
      expect(movedCard?.sectionId).toBe("sec-2");
      expect(movedCard?.position).toBe(3000);

      // Verify sorted order in destination section (1000, then 3000)
      expect(sec2?.issues?.map(i => i.id)).toEqual(["card-3", "card-1"]);
    });

    it("reorders a card within the same section", () => {
      const updated = applyCardMoved(board, {
        cardId: "card-2",
        sourceList: "sec-1",
        destList: "sec-1",
        position: 500
      });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      expect(sec1?.issues?.map(i => i.id)).toEqual(["card-2", "card-1"]);
      expect(sec1?.issues?.[0]?.position).toBe(500);
    });

    it("inserts a newly created card into its target section in sorted position", () => {
      const newCard: BoardIssue = {
        id: "card-new-1",
        title: "Brand New Task",
        position: 1500,
        priority: "urgent",
        isArchived: false,
        boardId: "board-test-1",
        sectionId: "sec-1"
      };

      const updated = applyCardCreated(board, {
        cardData: newCard
      });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      expect(sec1?.issues?.length).toBe(3);
      expect(sec1?.issues?.map(i => i.id)).toEqual(["card-1", "card-new-1", "card-2"]);
    });

    it("ignores duplicate card creation for already present card ID", () => {
      const existingCard = board.section![0]!.issues![0]!;
      const updated = applyCardCreated(board, { cardData: existingCard });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      expect(sec1?.issues?.length).toBe(2);
    });

    it("updates card fields and maintains sort order", () => {
      const updated = applyCardUpdated(board, {
        cardId: "card-1",
        updates: {
          title: "Renamed Task 1",
          priority: "urgent",
          position: 2500
        }
      });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      const card = sec1?.issues?.find(i => i.id === "card-1");
      expect(card?.title).toBe("Renamed Task 1");
      expect(card?.priority).toBe("urgent");
      // Since card-1 position changed to 2500, it should now appear after card-2 (pos 2000)
      expect(sec1?.issues?.map(i => i.id)).toEqual(["card-2", "card-1"]);
    });

    it("deletes a card from section cleanly", () => {
      const updated = applyCardDeleted(board, {
        cardId: "card-2"
      });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      expect(sec1?.issues?.length).toBe(1);
      expect(sec1?.issues?.[0]?.id).toBe("card-1");
    });
  });

  describe("2. List / Section Event Reducers", () => {
    it("adds a new section and keeps sections sorted by position ascending", () => {
      const newSection: BoardSection = {
        id: "sec-new",
        title: "Done",
        position: 3000,
        isArchived: false,
        issues: []
      };

      const updated = applyListCreated(board, {
        listData: newSection
      });

      expect(updated.section?.length).toBe(3);
      expect(updated.section?.map(s => s.id)).toEqual(["sec-1", "sec-2", "sec-new"]);
    });

    it("updates section title, wipLimit, and isArchived", () => {
      const updated = applyListUpdated(board, {
        listId: "sec-1",
        title: "Sprint Backlog",
        wipLimit: 5,
        isArchived: true
      });

      const sec1 = updated.section?.find(s => s.id === "sec-1");
      expect(sec1?.title).toBe("Sprint Backlog");
      expect(sec1?.wipLimit).toBe(5);
      expect(sec1?.isArchived).toBe(true);
    });

    it("reorders sections and sorts them by newPosition", () => {
      const updated = applyListReordered(board, {
        listId: "sec-2",
        newPosition: 500
      });

      expect(updated.section?.map(s => s.id)).toEqual(["sec-2", "sec-1"]);
      expect(updated.section?.[0]?.position).toBe(500);
    });

    it("deletes a section and reassigns issues to targetSectionId when provided", () => {
      const updated = applyListDeleted(board, {
        listId: "sec-1",
        targetSectionId: "sec-2"
      });

      expect(updated.section?.length).toBe(1);
      const sec2 = updated.section?.[0];
      expect(sec2?.id).toBe("sec-2");
      // All 3 issues should now be in sec-2
      expect(sec2?.issues?.length).toBe(3);
      expect(sec2?.issues?.every(i => i.sectionId === "sec-2")).toBe(true);
    });

    it("deletes a section cleanly without reassignment if targetSectionId is omitted", () => {
      const updated = applyListDeleted(board, {
        listId: "sec-1"
      });

      expect(updated.section?.length).toBe(1);
      expect(updated.section?.[0]?.id).toBe("sec-2");
    });
  });

  describe("3. Board Metadata Event Reducer", () => {
    it("updates board title, description, color, and archived status", () => {
      const updated = applyBoardUpdated(board, {
        boardId: "board-test-1",
        title: "Project Beta Deluxe",
        description: "New Description Here",
        color: "#10b981",
        isArchived: true
      });

      expect(updated.title).toBe("Project Beta Deluxe");
      expect(updated.description).toBe("New Description Here");
      expect(updated.color).toBe("#10b981");
      expect(updated.isArchived).toBe(true);
      // Sections remain intact
      expect(updated.section?.length).toBe(2);
    });
  });

  describe("4. TanStack Query Cache Integration", () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      queryClient = new QueryClient();
    });

    it("initializes and updates cache without throwing", () => {
      queryClient.setQueryData(["board", "b-init"], board);
      const cached = queryClient.getQueryData<BoardDetail>(["board", "b-init"]);
      expect(cached?.title).toBe("Project Alpha");

      // Mutate via applyCardMoved
      const updated = applyCardMoved(cached!, {
        cardId: "card-1",
        sourceList: "sec-1",
        destList: "sec-2",
        position: 3000
      });
      queryClient.setQueryData(["board", "b-init"], updated);

      const postMutation = queryClient.getQueryData<BoardDetail>(["board", "b-init"]);
      const sec2 = postMutation?.section?.find(s => s.id === "sec-2");
      expect(sec2?.issues?.some(i => i.id === "card-1")).toBe(true);
    });
  });
});
