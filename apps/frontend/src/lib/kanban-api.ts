import { api } from "./api";
import type { BoardIssue, BoardSection } from "./board-api";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Label {
  id: string;
  name: string;
  color: string;
  boardId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IssueLabelItem {
  id?: string;
  issueId?: string;
  labelId?: string;
  createdAt?: string;
  label: Label;
}

export interface IssueAssigneeUser {
  id: string;
  username: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface IssueMappingItem {
  id?: string;
  userId?: string;
  issueId?: string;
  user: IssueAssigneeUser;
}

export interface ChecklistItem {
  id: string;
  content: string;
  title?: string;
  isCompleted: boolean;
  position: number;
  dueDate?: string | null;
  checklistId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Checklist {
  id: string;
  title: string;
  position: number;
  issueId: string;
  items: ChecklistItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface IssueDetail extends Omit<BoardIssue, "checklists" | "labels" | "issueMappings"> {
  board?: { id: string; title: string };
  section?: { id: string; title: string };
  checklists: Checklist[];
  labels: IssueLabelItem[];
  issueMappings: IssueMappingItem[];
}

export interface CommentNode {
  id: string;
  description: string;
  parentId: string | null;
  createdAt: string;
  deletedAt: string | null;
  user: {
    id?: string;
    username: string;
    email?: string;
    name?: string;
  };
  issue?: {
    id: string;
    title: string;
  };
  children: CommentNode[];
}

export interface CreateSectionPayload {
  title: string;
  position?: number;
  wipLimit?: number | null;
}

export interface UpdateSectionPayload {
  title?: string;
  position?: number;
  newPosition?: number;
  wipLimit?: number | null;
  isArchived?: boolean;
}

export interface CreateIssuePayload {
  title: string;
  boardId: string;
  description?: string;
  position?: number;
  priority?: Priority;
  dueDate?: string | null;
  startDate?: string | null;
  gh_url?: string;
}

export interface UpdateIssuePayload {
  title?: string;
  sectionId?: string;
  destList?: string;
  position?: number;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  startDate?: string | null;
  gh_url?: string;
  isArchived?: boolean;
}

export interface CreateCommentPayload {
  description: string;
  parentId?: string | null;
}

export interface UpdateCommentPayload {
  description: string;
}

/**
 * Safely extract human-readable error messages from API rejections.
 */
export function getKanbanErrorMessage(err: unknown, fallbackMessage = "An unexpected error occurred"): string {
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

export const kanbanApi = {
  // --- Section / Column Endpoints ---
  createSection: async (boardId: string, payload: CreateSectionPayload): Promise<BoardSection> => {
    const res = await api.post<{ success: boolean; data: BoardSection }>(
      `/api/boards/${boardId}/sections`,
      {
        title: payload.title,
        ...(payload.position !== undefined ? { position: payload.position } : {})
      }
    );
    let section = res.data.data;

    // Backend createSection doesn't accept wipLimit; if wipLimit is set, persist via PATCH
    if (payload.wipLimit !== undefined && payload.wipLimit !== null) {
      const updateRes = await api.patch<{ success: boolean; data: BoardSection }>(
        `/api/sections/${section.id}`,
        { wipLimit: payload.wipLimit }
      );
      section = updateRes.data.data;
    }

    return section;
  },

  updateSection: async (sectionId: string, updates: UpdateSectionPayload): Promise<BoardSection> => {
    const res = await api.patch<{ success: boolean; data: BoardSection }>(
      `/api/sections/${sectionId}`,
      updates
    );
    return res.data.data;
  },

  deleteSection: async (sectionId: string, targetSectionId?: string): Promise<{ success: boolean; data: string }> => {
    const config = targetSectionId
      ? {
          params: { targetSectionId },
          data: { targetSectionId }
        }
      : undefined;

    const res = await api.delete<{ success: boolean; data: string }>(
      `/api/sections/${sectionId}`,
      config
    );
    return res.data;
  },

  // --- Issue / Card Endpoints ---
  createIssue: async (sectionId: string, payload: CreateIssuePayload): Promise<BoardIssue> => {
    const res = await api.post<{ success: boolean; data: BoardIssue }>(
      `/api/sections/${sectionId}/issues`,
      payload
    );
    return res.data.data;
  },

  getIssueDetail: async (issueId: string): Promise<IssueDetail> => {
    const res = await api.get<{ success: boolean; data: IssueDetail }>(
      `/api/issues/${issueId}`
    );
    return res.data.data;
  },

  updateIssue: async (issueId: string, updates: UpdateIssuePayload): Promise<BoardIssue> => {
    const res = await api.patch<{ success: boolean; data: BoardIssue }>(
      `/api/issues/${issueId}`,
      updates
    );
    return res.data.data;
  },

  deleteIssue: async (issueId: string): Promise<{ success: boolean; data: string }> => {
    const res = await api.delete<{ success: boolean; data: string }>(
      `/api/issues/${issueId}`
    );
    return res.data;
  },

  moveIssue: async (issueId: string, sectionId: string, position?: number): Promise<BoardIssue> => {
    const res = await api.patch<{ success: boolean; data: BoardIssue }>(
      `/api/cards/${issueId}/move`,
      {
        sectionId,
        destList: sectionId,
        ...(position !== undefined ? { position } : {})
      }
    );
    return res.data.data;
  },

  // --- Assignees ---
  assignIssue: async (issueId: string, emails: string[]): Promise<string> => {
    const res = await api.post<{ success: boolean; data: string }>(
      `/api/issues/${issueId}/assignees`,
      { email: emails }
    );
    return res.data.data;
  },

  removeAssignment: async (issueId: string, email: string): Promise<string> => {
    const res = await api.delete<{ success: boolean; data: string }>(
      `/api/issues/${issueId}/assignees/`,
      {
        data: { email }
      }
    );
    return res.data.data;
  },

  // --- Labels ---
  getBoardLabels: async (boardId: string): Promise<Label[]> => {
    const res = await api.get<{ success: boolean; data: Label[] }>(
      `/api/boards/${boardId}/labels`
    );
    return res.data.data;
  },

  getLabels: async (boardId: string): Promise<Label[]> => {
    return kanbanApi.getBoardLabels(boardId);
  },

  createBoardLabel: async (boardId: string, payload: { name: string; color: string }): Promise<Label> => {
    const res = await api.post<{ success: boolean; data: Label }>(
      `/api/boards/${boardId}/labels`,
      payload
    );
    return res.data.data;
  },

  createLabel: async (boardId: string, payload: { name: string; color: string }): Promise<Label> => {
    return kanbanApi.createBoardLabel(boardId, payload);
  },

  attachLabel: async (issueId: string, labelId: string): Promise<IssueLabelItem> => {
    const res = await api.post<{ success: boolean; data: IssueLabelItem }>(
      `/api/issues/${issueId}/labels`,
      { labelId }
    );
    return res.data.data;
  },

  detachLabel: async (issueId: string, labelId: string): Promise<string> => {
    const res = await api.delete<{ success: boolean; data: string }>(
      `/api/issues/${issueId}/labels/${labelId}`
    );
    return res.data.data;
  },

  // --- Checklists ---
  createChecklist: async (issueId: string, payload: { title: string }): Promise<Checklist> => {
    const res = await api.post<{ success: boolean; data: Checklist }>(
      `/api/issues/${issueId}/checklists`,
      payload
    );
    return res.data.data;
  },

  deleteChecklist: async (checklistId: string): Promise<string> => {
    const res = await api.delete<{ success: boolean; data: string }>(
      `/api/checklists/${checklistId}`
    );
    return res.data.data;
  },

  addChecklistItem: async (
    checklistId: string,
    payload: { content: string; dueDate?: string | null }
  ): Promise<ChecklistItem> => {
    const res = await api.post<{ success: boolean; data: ChecklistItem }>(
      `/api/checklists/${checklistId}/items`,
      payload
    );
    return res.data.data;
  },

  updateChecklistItem: async (
    itemId: string,
    updates: { content?: string; isCompleted?: boolean; dueDate?: string | null }
  ): Promise<ChecklistItem> => {
    const res = await api.patch<{ success: boolean; data: ChecklistItem }>(
      `/api/checklists/items/${itemId}`,
      updates
    );
    return res.data.data;
  },

  // --- Comments ---
  getComments: async (issueId: string): Promise<CommentNode[]> => {
    const res = await api.get<{ success: boolean; data: CommentNode[] }>(
      `/api/issues/${issueId}/comments`
    );
    return res.data.data;
  },

  createComment: async (
    issueId: string,
    payload: CreateCommentPayload
  ): Promise<CommentNode> => {
    const res = await api.post<{ success: boolean; data: CommentNode }>(
      `/api/issues/${issueId}/comments`,
      payload
    );
    return res.data.data;
  },

  addComment: async (
    issueId: string,
    payload: CreateCommentPayload
  ): Promise<CommentNode> => {
    return kanbanApi.createComment(issueId, payload);
  },

  updateComment: async (
    commentId: string,
    payload: UpdateCommentPayload
  ): Promise<CommentNode> => {
    const res = await api.put<{ success: boolean; data: CommentNode }>(
      `/api/comments/${commentId}`,
      payload
    );
    return res.data.data;
  },

  editComment: async (
    commentId: string,
    payload: UpdateCommentPayload
  ): Promise<CommentNode> => {
    return kanbanApi.updateComment(commentId, payload);
  },

  deleteComment: async (commentId: string): Promise<string> => {
    const res = await api.delete<{ success: boolean; data: string }>(
      `/api/comments/${commentId}`
    );
    return res.data.data;
  }
};
