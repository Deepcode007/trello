import { describe, it, expect, afterEach, mock } from "bun:test";
import {
  kanbanApi,
  getKanbanErrorMessage,
  type Label,
  type Checklist,
  type ChecklistItem,
  type CommentNode,
  type IssueDetail
} from "../lib/kanban-api";
import { api } from "../lib/api";
import type { BoardIssue, BoardSection } from "../lib/board-api";

describe("kanban-api client and error parsing", () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const originalPatch = api.patch;
  const originalPut = api.put;
  const originalDelete = api.delete;

  afterEach(() => {
    api.get = originalGet;
    api.post = originalPost;
    api.patch = originalPatch;
    api.put = originalPut;
    api.delete = originalDelete;
  });

  describe("getKanbanErrorMessage", () => {
    it("extracts response.data.error from Axios rejection object", () => {
      const err = {
        response: {
          status: 400,
          data: {
            success: false,
            error: "targetSectionId is required to reassign issues when deleting a non-empty section"
          }
        }
      };
      expect(getKanbanErrorMessage(err)).toBe(
        "targetSectionId is required to reassign issues when deleting a non-empty section"
      );
    });

    it("extracts response.data.message when error property is absent", () => {
      const err = {
        response: {
          status: 400,
          data: {
            message: "Validation failed"
          }
        }
      };
      expect(getKanbanErrorMessage(err)).toBe("Validation failed");
    });

    it("prefers response.data.error over response.data.message", () => {
      const err = {
        response: {
          status: 403,
          data: {
            error: "Admin access required",
            message: "Forbidden"
          }
        }
      };
      expect(getKanbanErrorMessage(err)).toBe("Admin access required");
    });

    it("falls back to top-level err.message when response.data has no error string", () => {
      const err = new Error("Network timeout");
      expect(getKanbanErrorMessage(err)).toBe("Network timeout");
    });

    it("returns default fallbackMessage when err is an empty object or null", () => {
      expect(getKanbanErrorMessage({})).toBe("An unexpected error occurred");
      expect(getKanbanErrorMessage(null)).toBe("An unexpected error occurred");
      expect(getKanbanErrorMessage(undefined, "Custom error")).toBe("Custom error");
    });
  });

  describe("Sections API", () => {
    it("createSection creates section without wipLimit", async () => {
      const mockCreated: BoardSection = {
        id: "sec-1",
        title: "To Do",
        position: 1000,
        isArchived: false,
        wipLimit: null
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/boards/board-1/sections");
        expect(payload).toEqual({ title: "To Do", position: 1000 });
        return Promise.resolve({ data: { success: true, data: mockCreated } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.createSection("board-1", {
        title: "To Do",
        position: 1000
      });
      expect(result.id).toBe("sec-1");
      expect(result.title).toBe("To Do");
      expect(result.wipLimit).toBeNull();
    });

    it("createSection with wipLimit sends follow-up PATCH to set wipLimit", async () => {
      const mockCreated: BoardSection = {
        id: "sec-2",
        title: "In Progress",
        position: 2000,
        isArchived: false,
        wipLimit: null
      };

      const mockUpdated: BoardSection = {
        ...mockCreated,
        wipLimit: 5
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/boards/board-1/sections");
        expect(payload).toEqual({ title: "In Progress" });
        return Promise.resolve({ data: { success: true, data: mockCreated } });
      }) as unknown as typeof api.post;

      api.patch = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/sections/sec-2");
        expect(payload).toEqual({ wipLimit: 5 });
        return Promise.resolve({ data: { success: true, data: mockUpdated } });
      }) as unknown as typeof api.patch;

      const result = await kanbanApi.createSection("board-1", {
        title: "In Progress",
        wipLimit: 5
      });
      expect(result.id).toBe("sec-2");
      expect(result.wipLimit).toBe(5);
    });

    it("updateSection updates title and wipLimit", async () => {
      const mockUpdated: BoardSection = {
        id: "sec-1",
        title: "Reviewing",
        position: 1000,
        isArchived: false,
        wipLimit: 3
      };

      api.patch = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/sections/sec-1");
        expect(payload).toEqual({ title: "Reviewing", wipLimit: 3 });
        return Promise.resolve({ data: { success: true, data: mockUpdated } });
      }) as unknown as typeof api.patch;

      const result = await kanbanApi.updateSection("sec-1", {
        title: "Reviewing",
        wipLimit: 3
      });
      expect(result.title).toBe("Reviewing");
      expect(result.wipLimit).toBe(3);
    });

    it("deleteSection deletes empty section without targetSectionId", async () => {
      api.delete = mock((url: string, config: unknown) => {
        expect(url).toBe("/api/sections/sec-empty");
        expect(config).toBeUndefined();
        return Promise.resolve({
          data: { success: true, data: "deleted section: To Do" }
        });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.deleteSection("sec-empty");
      expect(result.success).toBe(true);
      expect(result.data).toBe("deleted section: To Do");
    });

    it("deleteSection passes targetSectionId in params and body data", async () => {
      api.delete = mock((url: string, config: any) => {
        expect(url).toBe("/api/sections/sec-with-cards");
        expect(config.params).toEqual({ targetSectionId: "sec-target" });
        expect(config.data).toEqual({ targetSectionId: "sec-target" });
        return Promise.resolve({
          data: {
            success: true,
            data: "deleted section: Done and reassigned 3 issues"
          }
        });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.deleteSection("sec-with-cards", "sec-target");
      expect(result.success).toBe(true);
      expect(result.data).toContain("reassigned 3 issues");
    });
  });

  describe("Issues API", () => {
    it("createIssue posts with required boardId and returns created issue", async () => {
      const mockIssue: BoardIssue = {
        id: "iss-1",
        title: "Implement auth token refresh",
        position: 1000,
        priority: "high",
        isArchived: false,
        boardId: "board-1",
        sectionId: "sec-1"
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/sections/sec-1/issues");
        expect(payload).toEqual({
          title: "Implement auth token refresh",
          boardId: "board-1",
          priority: "high"
        });
        return Promise.resolve({ data: { success: true, data: mockIssue } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.createIssue("sec-1", {
        title: "Implement auth token refresh",
        boardId: "board-1",
        priority: "high"
      });
      expect(result.id).toBe("iss-1");
      expect(result.priority).toBe("high");
    });

    it("getIssueDetail retrieves full issue hierarchy", async () => {
      const mockDetail: IssueDetail = {
        id: "iss-1",
        title: "Implement auth token refresh",
        position: 1000,
        priority: "urgent",
        isArchived: false,
        boardId: "board-1",
        sectionId: "sec-1",
        board: { id: "board-1", title: "Project Alpha" },
        section: { id: "sec-1", title: "In Progress" },
        labels: [{ label: { id: "lbl-1", name: "Security", color: "#ef4444" } }],
        issueMappings: [
          {
            user: {
              id: "u-1",
              username: "alice",
              email: "alice@test.com",
              name: "Alice",
              avatarUrl: null
            }
          }
        ],
        checklists: [
          {
            id: "chk-1",
            title: "Acceptance Criteria",
            position: 1000,
            issueId: "iss-1",
            items: [
              {
                id: "item-1",
                content: "Unit tests pass",
                isCompleted: true,
                position: 1000,
                checklistId: "chk-1"
              }
            ]
          }
        ]
      };

      api.get = mock((url: string) => {
        expect(url).toBe("/api/issues/iss-1");
        return Promise.resolve({ data: { success: true, data: mockDetail } });
      }) as unknown as typeof api.get;

      const result = await kanbanApi.getIssueDetail("iss-1");
      expect(result.id).toBe("iss-1");
      expect(result.labels.length).toBe(1);
      expect(result.labels[0]?.label.name).toBe("Security");
      expect(result.checklists[0]?.items[0]?.isCompleted).toBe(true);
    });

    it("updateIssue sends patch updates", async () => {
      const mockUpdated: BoardIssue = {
        id: "iss-1",
        title: "Updated Title",
        position: 1000,
        priority: "low",
        isArchived: false,
        boardId: "board-1",
        sectionId: "sec-1"
      };

      api.patch = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/issues/iss-1");
        expect(payload).toEqual({ title: "Updated Title", priority: "low" });
        return Promise.resolve({ data: { success: true, data: mockUpdated } });
      }) as unknown as typeof api.patch;

      const result = await kanbanApi.updateIssue("iss-1", {
        title: "Updated Title",
        priority: "low"
      });
      expect(result.title).toBe("Updated Title");
      expect(result.priority).toBe("low");
    });

    it("deleteIssue deletes the issue", async () => {
      api.delete = mock((url: string) => {
        expect(url).toBe("/api/issues/iss-1");
        return Promise.resolve({
          data: { success: true, data: 'issue: "iss-1" deleted' }
        });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.deleteIssue("iss-1");
      expect(result.success).toBe(true);
      expect(result.data).toContain("deleted");
    });

    it("moveIssue calls move endpoint with sectionId, destList, and position", async () => {
      const mockMoved: BoardIssue = {
        id: "iss-1",
        title: "Moved Card",
        position: 500,
        priority: "medium",
        isArchived: false,
        boardId: "board-1",
        sectionId: "sec-2"
      };

      api.patch = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/cards/iss-1/move");
        expect(payload).toEqual({
          sectionId: "sec-2",
          destList: "sec-2",
          position: 500
        });
        return Promise.resolve({ data: { success: true, data: mockMoved } });
      }) as unknown as typeof api.patch;

      const result = await kanbanApi.moveIssue("iss-1", "sec-2", 500);
      expect(result.sectionId).toBe("sec-2");
      expect(result.position).toBe(500);
    });
  });

  describe("Assignees API", () => {
    it("assignIssue posts email array to assignees endpoint", async () => {
      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/issues/iss-1/assignees");
        expect(payload).toEqual({ email: ["alice@test.com", "bob@test.com"] });
        return Promise.resolve({ data: { success: true, data: "assigned 2" } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.assignIssue("iss-1", [
        "alice@test.com",
        "bob@test.com"
      ]);
      expect(result).toBe("assigned 2");
    });

    it("removeAssignment sends delete with email in data payload", async () => {
      api.delete = mock((url: string, config: any) => {
        expect(url).toBe("/api/issues/iss-1/assignees/");
        expect(config.data).toEqual({ email: "alice@test.com" });
        return Promise.resolve({
          data: { success: true, data: "unassigned alice@test.com" }
        });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.removeAssignment("iss-1", "alice@test.com");
      expect(result).toContain("unassigned alice@test.com");
    });
  });

  describe("Labels API", () => {
    it("getBoardLabels fetches all labels for a board", async () => {
      const mockLabels: Label[] = [
        { id: "lbl-1", name: "Bug", color: "#ef4444", boardId: "board-1" },
        { id: "lbl-2", name: "Feature", color: "#3b82f6", boardId: "board-1" }
      ];

      api.get = mock((url: string) => {
        expect(url).toBe("/api/boards/board-1/labels");
        return Promise.resolve({ data: { success: true, data: mockLabels } });
      }) as unknown as typeof api.get;

      const result = await kanbanApi.getBoardLabels("board-1");
      expect(result.length).toBe(2);
      expect(result[0]?.name).toBe("Bug");
    });

    it("createBoardLabel creates a new label", async () => {
      const mockLabel: Label = {
        id: "lbl-3",
        name: "DevOps",
        color: "#10b981",
        boardId: "board-1"
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/boards/board-1/labels");
        expect(payload).toEqual({ name: "DevOps", color: "#10b981" });
        return Promise.resolve({ data: { success: true, data: mockLabel } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.createBoardLabel("board-1", {
        name: "DevOps",
        color: "#10b981"
      });
      expect(result.id).toBe("lbl-3");
      expect(result.name).toBe("DevOps");
    });

    it("attachLabel associates a label with an issue", async () => {
      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/issues/iss-1/labels");
        expect(payload).toEqual({ labelId: "lbl-1" });
        return Promise.resolve({
          data: {
            success: true,
            data: {
              id: "map-1",
              labelId: "lbl-1",
              issueId: "iss-1",
              label: { id: "lbl-1", name: "Bug", color: "#ef4444" }
            }
          }
        });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.attachLabel("iss-1", "lbl-1");
      expect(result.label.name).toBe("Bug");
    });

    it("detachLabel disassociates a label from an issue", async () => {
      api.delete = mock((url: string) => {
        expect(url).toBe("/api/issues/iss-1/labels/lbl-1");
        return Promise.resolve({
          data: { success: true, data: "Label removed from card" }
        });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.detachLabel("iss-1", "lbl-1");
      expect(result).toBe("Label removed from card");
    });
  });

  describe("Checklists API", () => {
    it("createChecklist creates a new checklist on an issue", async () => {
      const mockChecklist: Checklist = {
        id: "chk-1",
        title: "Testing Steps",
        position: 1000,
        issueId: "iss-1",
        items: []
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/issues/iss-1/checklists");
        expect(payload).toEqual({ title: "Testing Steps" });
        return Promise.resolve({ data: { success: true, data: mockChecklist } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.createChecklist("iss-1", {
        title: "Testing Steps"
      });
      expect(result.id).toBe("chk-1");
      expect(result.title).toBe("Testing Steps");
    });

    it("deleteChecklist removes a checklist", async () => {
      api.delete = mock((url: string) => {
        expect(url).toBe("/api/checklists/chk-1");
        return Promise.resolve({
          data: { success: true, data: "Checklist deleted" }
        });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.deleteChecklist("chk-1");
      expect(result).toBe("Checklist deleted");
    });

    it("addChecklistItem adds a subtask to a checklist", async () => {
      const mockItem: ChecklistItem = {
        id: "item-1",
        content: "Run test suite",
        isCompleted: false,
        position: 1000,
        checklistId: "chk-1"
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/checklists/chk-1/items");
        expect(payload).toEqual({ content: "Run test suite", dueDate: null });
        return Promise.resolve({ data: { success: true, data: mockItem } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.addChecklistItem("chk-1", {
        content: "Run test suite",
        dueDate: null
      });
      expect(result.id).toBe("item-1");
      expect(result.content).toBe("Run test suite");
      expect(result.isCompleted).toBe(false);
    });

    it("updateChecklistItem toggles completion and updates content", async () => {
      const mockUpdatedItem: ChecklistItem = {
        id: "item-1",
        content: "Run test suite (updated)",
        isCompleted: true,
        position: 1000,
        checklistId: "chk-1"
      };

      api.patch = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/checklists/items/item-1");
        expect(payload).toEqual({ isCompleted: true });
        return Promise.resolve({
          data: { success: true, data: mockUpdatedItem }
        });
      }) as unknown as typeof api.patch;

      const result = await kanbanApi.updateChecklistItem("item-1", {
        isCompleted: true
      });
      expect(result.isCompleted).toBe(true);
    });
  });

  describe("Comments API", () => {
    it("getComments fetches hierarchical comment tree", async () => {
      const mockComments: CommentNode[] = [
        {
          id: "cmt-1",
          description: "Top-level comment",
          parentId: null,
          createdAt: new Date().toISOString(),
          deletedAt: null,
          user: { username: "alice" },
          children: [
            {
              id: "cmt-2",
              description: "Nested reply",
              parentId: "cmt-1",
              createdAt: new Date().toISOString(),
              deletedAt: null,
              user: { username: "bob" },
              children: []
            }
          ]
        }
      ];

      api.get = mock((url: string) => {
        expect(url).toBe("/api/issues/iss-1/comments");
        return Promise.resolve({ data: { success: true, data: mockComments } });
      }) as unknown as typeof api.get;

      const result = await kanbanApi.getComments("iss-1");
      expect(result.length).toBe(1);
      expect(result[0]?.children.length).toBe(1);
      expect(result[0]?.children[0]?.description).toBe("Nested reply");
    });

    it("createComment adds a new comment or reply", async () => {
      const mockComment: CommentNode = {
        id: "cmt-3",
        description: "Replying to thread",
        parentId: "cmt-1",
        createdAt: new Date().toISOString(),
        deletedAt: null,
        user: { username: "charlie" },
        children: []
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/issues/iss-1/comments");
        expect(payload).toEqual({
          description: "Replying to thread",
          parentId: "cmt-1"
        });
        return Promise.resolve({ data: { success: true, data: mockComment } });
      }) as unknown as typeof api.post;

      const result = await kanbanApi.createComment("iss-1", {
        description: "Replying to thread",
        parentId: "cmt-1"
      });
      expect(result.id).toBe("cmt-3");
      expect(result.parentId).toBe("cmt-1");
    });

    it("updateComment edits existing comment", async () => {
      const mockUpdated: CommentNode = {
        id: "cmt-3",
        description: "Edited description",
        parentId: "cmt-1",
        createdAt: new Date().toISOString(),
        deletedAt: null,
        user: { username: "charlie" },
        children: []
      };

      api.put = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/comments/cmt-3");
        expect(payload).toEqual({ description: "Edited description" });
        return Promise.resolve({ data: { success: true, data: mockUpdated } });
      }) as unknown as typeof api.put;

      const result = await kanbanApi.updateComment("cmt-3", {
        description: "Edited description"
      });
      expect(result.description).toBe("Edited description");
    });

    it("deleteComment deletes comment and returns confirmation", async () => {
      api.delete = mock((url: string) => {
        expect(url).toBe("/api/comments/cmt-3");
        return Promise.resolve({ data: { success: true, data: "cmt-3" } });
      }) as unknown as typeof api.delete;

      const result = await kanbanApi.deleteComment("cmt-3");
      expect(result).toBe("cmt-3");
    });
  });
});
