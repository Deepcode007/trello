import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { boardApi, type CreateBoardPayload, type UpdateBoardPayload } from "../lib/board-api";

export function useOrgBoardsQuery(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["boards", orgId],
    queryFn: () => {
      if (!orgId) throw new Error("Org ID is required to fetch boards");
      return boardApi.getOrgBoards(orgId);
    },
    enabled: Boolean(orgId)
  });
}

export function useBoardDetailsQuery(boardId: string | null | undefined) {
  return useQuery({
    queryKey: ["board", boardId],
    queryFn: () => {
      if (!boardId) throw new Error("Board ID is required to fetch board details");
      return boardApi.getBoardDetails(boardId);
    },
    enabled: Boolean(boardId)
  });
}

export function useCreateBoardMutation(orgId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBoardPayload) => {
      if (!orgId) throw new Error("Org ID is required to create a board");
      return boardApi.createBoard(orgId, payload);
    },
    onSuccess: () => {
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: ["boards", orgId] });
      }
    }
  });
}

export function useUpdateBoardMutation(boardId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateBoardPayload) => {
      if (!boardId) throw new Error("Board ID is required to update board");
      return boardApi.updateBoard(boardId, payload);
    },
    onSuccess: updatedBoard => {
      if (boardId) {
        queryClient.invalidateQueries({ queryKey: ["board", boardId] });
      }
      if (updatedBoard?.orgId) {
        queryClient.invalidateQueries({ queryKey: ["boards", updatedBoard.orgId] });
      }
    }
  });
}

export function useDeleteBoardMutation(boardId: string | null | undefined, orgId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!boardId) throw new Error("Board ID is required to delete board");
      return boardApi.deleteBoard(boardId);
    },
    onSuccess: () => {
      if (boardId) {
        queryClient.removeQueries({ queryKey: ["board", boardId] });
      }
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: ["boards", orgId] });
      }
    }
  });
}
