import { describe, it, expect, afterEach, mock } from "bun:test";
import {
  boardApi,
  getBoardErrorMessage,
  type BoardSummary,
  type BoardDetail
} from "../lib/board-api";
import { api } from "../lib/api";

describe("board-api client and error parsing", () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const originalPut = api.put;
  const originalDelete = api.delete;

  afterEach(() => {
    api.get = originalGet;
    api.post = originalPost;
    api.put = originalPut;
    api.delete = originalDelete;
  });

  describe("getBoardErrorMessage", () => {
    it("extracts response.data.error from Axios rejection object", () => {
      const err = {
        response: {
          status: 404,
          data: {
            success: false,
            error: "Board not found"
          }
        }
      };
      expect(getBoardErrorMessage(err)).toBe("Board not found");
    });

    it("extracts response.data.message when error property is absent", () => {
      const err = {
        response: {
          status: 400,
          data: {
            message: "Validation failed: Title is required"
          }
        }
      };
      expect(getBoardErrorMessage(err)).toBe("Validation failed: Title is required");
    });

    it("prefers response.data.error over response.data.message", () => {
      const err = {
        response: {
          status: 403,
          data: {
            error: "Admin/Employee access only",
            message: "Forbidden"
          }
        }
      };
      expect(getBoardErrorMessage(err)).toBe("Admin/Employee access only");
    });

    it("falls back to top-level err.message when response.data has no error string", () => {
      const err = new Error("Network connection lost");
      expect(getBoardErrorMessage(err)).toBe("Network connection lost");
    });

    it("returns default fallbackMessage when err is an empty object or null", () => {
      expect(getBoardErrorMessage({})).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage(null)).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage(undefined, "Custom fallback")).toBe("Custom fallback");
    });
  });

  describe("getOrgBoards (GET /api/orgs/:orgId/boards)", () => {
    it("fetches boards list for the specified organization", async () => {
      const mockBoards: BoardSummary[] = [
        {
          id: "b-1",
          title: "Sprint Board",
          description: "Main sprint backlog",
          color: "#3b82f6",
          isArchived: false,
          orgId: "org-1",
          _count: { issues: 8 }
        },
        {
          id: "b-2",
          title: "Archived Roadmap",
          description: null,
          color: null,
          isArchived: true,
          orgId: "org-1",
          _count: { issues: 0 }
        }
      ];

      api.get = mock((url: string) => {
        expect(url).toBe("/api/orgs/org-1/boards");
        return Promise.resolve({
          data: { success: true, data: mockBoards }
        });
      }) as unknown as typeof api.get;

      const result = await boardApi.getOrgBoards("org-1");
      expect(result.length).toBe(2);
      expect(result[0]?.title).toBe("Sprint Board");
      expect(result[0]?._count?.issues).toBe(8);
      expect(result[1]?.isArchived).toBe(true);
    });

    it("propagates error when user is not a member of the organization", async () => {
      const err = Object.assign(new Error("Request failed with status code 403"), {
        response: {
          status: 403,
          data: { success: false, error: "Members only" }
        }
      });

      api.get = mock(() => Promise.reject(err)) as unknown as typeof api.get;

      let errorThrown: unknown;
      try {
        await boardApi.getOrgBoards("org-forbidden");
      } catch (e) {
        errorThrown = e;
      }
      expect(errorThrown).toBeDefined();
    });
  });

  describe("createBoard (POST /api/orgs/:orgId/boards)", () => {
    it("creates a board with only title and returns the new board", async () => {
      const mockCreated: BoardSummary = {
        id: "b-new",
        title: "Product Launch",
        description: null,
        color: null,
        isArchived: false,
        orgId: "org-1"
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/orgs/org-1/boards");
        expect(payload).toEqual({ title: "Product Launch" });
        return Promise.resolve({
          data: { success: true, data: mockCreated }
        });
      }) as unknown as typeof api.post;

      const result = await boardApi.createBoard("org-1", { title: "Product Launch" });
      expect(result.id).toBe("b-new");
      expect(result.title).toBe("Product Launch");
    });

    it("persists description and color via immediate PUT if provided in payload", async () => {
      const initialCreated: BoardSummary = {
        id: "b-new",
        title: "Marketing Campaign",
        description: null,
        color: null,
        isArchived: false,
        orgId: "org-1"
      };

      const finalBoard: BoardSummary = {
        ...initialCreated,
        description: "Q4 marketing initiatives",
        color: "#8b5cf6"
      };

      api.post = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/orgs/org-1/boards");
        expect(payload).toEqual({ title: "Marketing Campaign" });
        return Promise.resolve({
          data: { success: true, data: initialCreated }
        });
      }) as unknown as typeof api.post;

      api.put = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/boards/b-new");
        expect(payload).toEqual({
          description: "Q4 marketing initiatives",
          color: "#8b5cf6"
        });
        return Promise.resolve({
          data: { success: true, data: finalBoard }
        });
      }) as unknown as typeof api.put;

      const result = await boardApi.createBoard("org-1", {
        title: "Marketing Campaign",
        description: "Q4 marketing initiatives",
        color: "#8b5cf6"
      });

      expect(result.id).toBe("b-new");
      expect(result.description).toBe("Q4 marketing initiatives");
      expect(result.color).toBe("#8b5cf6");
    });

    it("propagates 403 Forbidden error when contributor attempts to create board", async () => {
      const err = Object.assign(new Error("Request failed with status code 403"), {
        response: {
          status: 403,
          data: { success: false, error: "Employee/Admin access only" }
        }
      });

      api.post = mock(() => Promise.reject(err)) as unknown as typeof api.post;

      let errorThrown: unknown;
      try {
        await boardApi.createBoard("org-1", { title: "Test" });
      } catch (e) {
        errorThrown = e;
      }
      expect(errorThrown).toBeDefined();
    });
  });

  describe("getBoardDetails (GET /api/boards/:boardId)", () => {
    it("fetches full board details with nested sections and issues", async () => {
      const mockDetail: BoardDetail = {
        id: "b-1",
        title: "Engineering Roadmap",
        description: "Core features",
        color: "#10b981",
        isArchived: false,
        orgId: "org-1",
        section: [
          {
            id: "sec-1",
            title: "In Progress",
            position: 1000,
            isArchived: false,
            issues: [
              {
                id: "iss-1",
                title: "Build Step 4 Frontend",
                position: 1000,
                priority: "urgent",
                isArchived: false,
                boardId: "b-1",
                sectionId: "sec-1"
              }
            ]
          }
        ]
      };

      api.get = mock((url: string) => {
        expect(url).toBe("/api/boards/b-1");
        return Promise.resolve({
          data: { success: true, data: mockDetail }
        });
      }) as unknown as typeof api.get;

      const result = await boardApi.getBoardDetails("b-1");
      expect(result.id).toBe("b-1");
      expect(result.section?.length).toBe(1);
      expect(result.section?.[0]?.issues?.[0]?.priority).toBe("urgent");
    });

    it("propagates 404 when board does not exist", async () => {
      const err = Object.assign(new Error("Request failed with status code 404"), {
        response: {
          status: 404,
          data: { success: false, error: "Board not found" }
        }
      });

      api.get = mock(() => Promise.reject(err)) as unknown as typeof api.get;

      let errorThrown: unknown;
      try {
        await boardApi.getBoardDetails("non-existent");
      } catch (e) {
        errorThrown = e;
      }
      expect(errorThrown).toBeDefined();
    });
  });

  describe("updateBoard (PUT /api/boards/:boardId)", () => {
    it("updates board attributes and returns updated summary", async () => {
      const mockUpdated: BoardSummary = {
        id: "b-1",
        title: "Renamed Title",
        description: "New description",
        color: "#f59e0b",
        isArchived: true,
        orgId: "org-1"
      };

      api.put = mock((url: string, payload: unknown) => {
        expect(url).toBe("/api/boards/b-1");
        expect(payload).toEqual({
          title: "Renamed Title",
          isArchived: true
        });
        return Promise.resolve({
          data: { success: true, data: mockUpdated }
        });
      }) as unknown as typeof api.put;

      const result = await boardApi.updateBoard("b-1", {
        title: "Renamed Title",
        isArchived: true
      });

      expect(result.title).toBe("Renamed Title");
      expect(result.isArchived).toBe(true);
    });
  });

  describe("deleteBoard (DELETE /api/boards/:boardId)", () => {
    it("deletes the board and returns confirmation string", async () => {
      api.delete = mock((url: string) => {
        expect(url).toBe("/api/boards/b-1");
        return Promise.resolve({
          data: { success: true, data: "board deleted" }
        });
      }) as unknown as typeof api.delete;

      const result = await boardApi.deleteBoard("b-1");
      expect(result).toBe("board deleted");
    });
  });
});
