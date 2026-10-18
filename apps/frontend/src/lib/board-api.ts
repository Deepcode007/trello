import { api } from "./api";

export interface BoardSummary {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  isArchived: boolean;
  orgId: string;
  createdAt?: string;
  updatedAt?: string;
  _count?: {
    issues: number;
  };
}

export interface BoardIssue {
  id: string;
  title: string;
  description?: string | null;
  position: number;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string | null;
  startDate?: string | null;
  isArchived: boolean;
  gh_url?: string | null;
  boardId: string;
  sectionId: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: Array<{
    label: {
      id: string;
      name: string;
      color: string;
    };
  }>;
  issueMappings?: Array<{
    user: {
      id: string;
      username: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    };
  }>;
  checklists?: Array<{
    id: string;
    title: string;
    position: number;
    items?: Array<{
      id: string;
      isCompleted: boolean;
      title?: string;
    }>;
  }>;
}

export interface BoardSection {
  id: string;
  title: string;
  position: number;
  wipLimit?: number | null;
  isArchived: boolean;
  issues?: BoardIssue[];
}

export interface BoardDetail extends BoardSummary {
  section?: BoardSection[];
}

export interface CreateBoardPayload {
  title: string;
  description?: string;
  color?: string;
}

export interface UpdateBoardPayload {
  title?: string;
  description?: string;
  color?: string;
  isArchived?: boolean;
}

export interface BoardApiErrorResponse {
  success: false;
  error: string;
}

/**
 * Safely extract human-readable error messages from API rejections.
 */
export function getBoardErrorMessage(err: unknown, fallbackMessage = "An unexpected error occurred"): string {
  if (err && typeof err === "object") {
    const axiosErr = err as {
      response?: {
        status?: number;
        data?: {
          error?: string;
          message?: string;
        };
      };
      message?: string;
    };

    const serverError = axiosErr.response?.data?.error || axiosErr.response?.data?.message;
    if (serverError && typeof serverError === "string") {
      return serverError;
    }

    if (axiosErr.message && typeof axiosErr.message === "string") {
      return axiosErr.message;
    }
  }

  return fallbackMessage;
}

export const boardApi = {
  /**
   * GET /api/orgs/:orgId/boards
   * Fetch all boards for an organization (accessible by all accepted members).
   */
  getOrgBoards: async (orgId: string): Promise<BoardSummary[]> => {
    const res = await api.get<{ success: boolean; data: BoardSummary[] }>(`/api/orgs/${orgId}/boards`);
    return res.data.data;
  },

  /**
   * POST /api/orgs/:orgId/boards
   * Create a new board. Backend create accepts title; if description or color
   * is provided, updates board details immediately to ensure persistence.
   */
  createBoard: async (orgId: string, payload: CreateBoardPayload): Promise<BoardSummary> => {
    const res = await api.post<{ success: boolean; data: BoardSummary }>(`/api/orgs/${orgId}/boards`, {
      title: payload.title
    });
    let board = res.data.data;

    // Persist description or color if provided
    const hasDesc = payload.description !== undefined && payload.description !== null && payload.description !== "";
    const hasColor = payload.color !== undefined && payload.color !== null && payload.color !== "";

    if (hasDesc || hasColor) {
      const updatePayload: UpdateBoardPayload = {};
      if (hasDesc) updatePayload.description = payload.description;
      if (hasColor) updatePayload.color = payload.color;

      const updateRes = await api.put<{ success: boolean; data: BoardSummary }>(
        `/api/boards/${board.id}`,
        updatePayload
      );
      board = updateRes.data.data;
    }

    return board;
  },

  /**
   * GET /api/boards/:boardId
   * Fetch full board details including sections and issues.
   */
  getBoardDetails: async (boardId: string): Promise<BoardDetail> => {
    const res = await api.get<{ success: boolean; data: BoardDetail }>(`/api/boards/${boardId}`);
    return res.data.data;
  },

  /**
   * PUT /api/boards/:boardId
   * Update board attributes (title, description, color, isArchived).
   */
  updateBoard: async (boardId: string, payload: UpdateBoardPayload): Promise<BoardSummary> => {
    const res = await api.put<{ success: boolean; data: BoardSummary }>(`/api/boards/${boardId}`, payload);
    return res.data.data;
  },

  /**
   * DELETE /api/boards/:boardId
   * Delete a board. Cascades to sections, issues, events, etc.
   */
  deleteBoard: async (boardId: string): Promise<string> => {
    const res = await api.delete<{ success: boolean; data: string }>(`/api/boards/${boardId}`);
    return res.data.data;
  }
};
