import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BoardDetail, BoardIssue } from "../lib/board-api";
import {
  kanbanApi,
  type CreateSectionPayload,
  type UpdateSectionPayload,
  type CreateIssuePayload,
  type UpdateIssuePayload,
  type CreateCommentPayload,
  type UpdateCommentPayload
} from "../lib/kanban-api";

// --- Section Mutations ---

export function useCreateSectionMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSectionPayload) => {
      if (!boardId) throw new Error("Board ID is required to create a section");
      return kanbanApi.createSection(boardId, payload);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
    }
  });
}

export function useUpdateSectionMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionId,
      updates
    }: {
      sectionId: string;
      updates: UpdateSectionPayload;
    }) => {
      return kanbanApi.updateSection(sectionId, updates);
    },
    onMutate: async ({ sectionId, updates }) => {
      if (!boardId) return { previousBoard: undefined };
      await queryClient.cancelQueries({ queryKey: ["board", boardId] });
      const previousBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);

      if (previousBoard && previousBoard.section) {
        const updatedSections = previousBoard.section.map(sec => {
          if (sec.id === sectionId) {
            return {
              ...sec,
              ...updates,
              position: updates.position !== undefined ? updates.position : sec.position
            };
          }
          return sec;
        });

        updatedSections.sort((a, b) => a.position - b.position);

        queryClient.setQueryData<BoardDetail>(["board", boardId], {
          ...previousBoard,
          section: updatedSections
        });
      }

      return { previousBoard };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousBoard && boardId) {
        queryClient.setQueryData(["board", boardId], context.previousBoard);
      }
    },
    onSettled: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
    }
  });
}

export function useDeleteSectionMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionId,
      targetSectionId
    }: {
      sectionId: string;
      targetSectionId?: string;
    }) => {
      return kanbanApi.deleteSection(sectionId, targetSectionId);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
    }
  });
}

// --- Issue Queries & Mutations ---

export function useIssueDetailQuery(issueId: string | null | undefined) {
  return useQuery({
    queryKey: ["issue", issueId],
    queryFn: () => {
      if (!issueId) throw new Error("Issue ID is required to fetch issue detail");
      return kanbanApi.getIssueDetail(issueId);
    },
    enabled: Boolean(issueId)
  });
}

export function useCreateIssueMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionId,
      payload
    }: {
      sectionId: string;
      payload: Omit<CreateIssuePayload, "boardId">;
    }) => {
      if (!boardId) throw new Error("Board ID is required to create an issue");
      return kanbanApi.createIssue(sectionId, {
        ...payload,
        boardId
      });
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
    }
  });
}

export function useUpdateIssueMutation(
  boardId: string | null | undefined,
  issueId?: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      issueId: targetId,
      updates
    }: {
      issueId?: string;
      updates: UpdateIssuePayload;
    }) => {
      const finalId = targetId || issueId;
      if (!finalId) throw new Error("Issue ID is required to update issue");
      return kanbanApi.updateIssue(finalId, updates);
    },
    onSuccess: (_, vars) => {
      const finalId = vars.issueId || issueId;
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (finalId) {
        queryClient.invalidateQueries({ queryKey: ["issue", finalId] });
      }
    }
  });
}

export function useDeleteIssueMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) => {
      return kanbanApi.deleteIssue(issueId);
    },
    onSuccess: (_, issueId) => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.removeQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

export function useMoveIssueMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      issueId,
      sectionId,
      position
    }: {
      issueId: string;
      sectionId: string;
      position?: number;
    }) => {
      return kanbanApi.moveIssue(issueId, sectionId, position);
    },
    onMutate: async ({ issueId, sectionId, position }) => {
      if (!boardId) return { previousBoard: undefined };
      await queryClient.cancelQueries({ queryKey: ["board", boardId] });
      const previousBoard = queryClient.getQueryData<BoardDetail>(["board", boardId]);

      if (previousBoard && previousBoard.section) {
        let movedCard: BoardIssue | null = null;

        // Step 1: Extract moved issue from current section
        const newSections = previousBoard.section.map(sec => {
          const card = sec.issues?.find(iss => iss.id === issueId);
          if (card) {
            movedCard = card;
            return {
              ...sec,
              issues: (sec.issues || []).filter(iss => iss.id !== issueId)
            };
          }
          return sec;
        });

        // Step 2: Insert into target section with new sectionId and position
        const targetCard = movedCard as BoardIssue | null;
        if (targetCard) {
          const updatedCard: BoardIssue = {
            ...targetCard,
            sectionId,
            position: position !== undefined ? position : targetCard.position
          };

          const finalSections = newSections.map(sec => {
            if (sec.id === sectionId) {
              const issues = [...(sec.issues || []), updatedCard].sort((a, b) => {
                if (a.position !== b.position) return a.position - b.position;
                return a.id.localeCompare(b.id);
              });
              return {
                ...sec,
                issues
              };
            }
            return sec;
          });

          queryClient.setQueryData<BoardDetail>(["board", boardId], {
            ...previousBoard,
            section: finalSections
          });
        }
      }

      return { previousBoard };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousBoard && boardId) {
        queryClient.setQueryData(["board", boardId], context.previousBoard);
      }
    },
    onSettled: (_, __, vars) => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (vars.issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", vars.issueId] });
      }
    }
  });
}

// --- Labels Queries & Mutations ---

export function useBoardLabelsQuery(boardId: string | null | undefined) {
  return useQuery({
    queryKey: ["labels", boardId],
    queryFn: () => {
      if (!boardId) throw new Error("Board ID is required to fetch labels");
      return kanbanApi.getBoardLabels(boardId);
    },
    enabled: Boolean(boardId)
  });
}

export function useCreateBoardLabelMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; color: string }) => {
      if (!boardId) throw new Error("Board ID is required to create label");
      return kanbanApi.createBoardLabel(boardId, payload);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["labels", boardId] });
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
    }
  });
}

export function useAttachLabelMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => {
      if (!issueId) throw new Error("Issue ID is required to attach label");
      return kanbanApi.attachLabel(issueId, labelId);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

export function useDetachLabelMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => {
      if (!issueId) throw new Error("Issue ID is required to detach label");
      return kanbanApi.detachLabel(issueId, labelId);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

// --- Assignee Mutations ---

export function useAssignIssueMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emails: string[]) => {
      if (!issueId) throw new Error("Issue ID is required to assign members");
      return kanbanApi.assignIssue(issueId, emails);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

export function useRemoveAssignmentMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => {
      if (!issueId) throw new Error("Issue ID is required to unassign member");
      return kanbanApi.removeAssignment(issueId, email);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

// --- Checklist Mutations ---

export function useCreateChecklistMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => {
      if (!issueId) throw new Error("Issue ID is required to create checklist");
      return kanbanApi.createChecklist(issueId, { title });
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

export function useDeleteChecklistMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (checklistId: string) => {
      return kanbanApi.deleteChecklist(checklistId);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

export function useAddChecklistItemMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      checklistId,
      content,
      dueDate
    }: {
      checklistId: string;
      content: string;
      dueDate?: string | null;
    }) => {
      return kanbanApi.addChecklistItem(checklistId, { content, dueDate });
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

export function useUpdateChecklistItemMutation(
  boardId: string | null | undefined,
  issueId: string | null | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      updates
    }: {
      itemId: string;
      updates: { content?: string; isCompleted?: boolean; dueDate?: string | null };
    }) => {
      return kanbanApi.updateChecklistItem(itemId, updates);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
      }
    }
  });
}

// --- Comments Queries & Mutations ---

export function useCommentsQuery(issueId: string | null | undefined) {
  return useQuery({
    queryKey: ["comments", issueId],
    queryFn: () => {
      if (!issueId) throw new Error("Issue ID is required to fetch comments");
      return kanbanApi.getComments(issueId);
    },
    enabled: Boolean(issueId)
  });
}

export function useCreateCommentMutation(issueId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCommentPayload) => {
      if (!issueId) throw new Error("Issue ID is required to create comment");
      return kanbanApi.createComment(issueId, payload);
    },
    onSuccess: () => {
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["comments", issueId] });
      }
    }
  });
}

export function useUpdateCommentMutation(issueId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      commentId,
      payload
    }: {
      commentId: string;
      payload: UpdateCommentPayload;
    }) => {
      return kanbanApi.updateComment(commentId, payload);
    },
    onSuccess: () => {
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["comments", issueId] });
      }
    }
  });
}

export function useDeleteCommentMutation(issueId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => {
      return kanbanApi.deleteComment(commentId);
    },
    onSuccess: () => {
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: ["comments", issueId] });
      }
    }
  });
}
