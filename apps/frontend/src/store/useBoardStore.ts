import { create } from "zustand";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface Collaborator {
  userId: string;
  name?: string;
  email?: string;
}

export interface BoardRealtimeState {
  connected: boolean;
  connectionStatus: ConnectionStatus;
  activeBoardId: string | null;
  collaborators: Record<string, Collaborator>;
  lastSeenSequence: string | null;

  setConnected: (connected: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setActiveBoardId: (boardId: string | null) => void;
  addCollaborator: (collaborator: Collaborator) => void;
  removeCollaborator: (userId: string) => void;
  setCollaborators: (collaborators: Record<string, Collaborator>) => void;
  setLastSeenSequence: (seq: string | null) => void;
  resetBoardState: () => void;
}

export const useBoardStore = create<BoardRealtimeState>(set => ({
  connected: false,
  connectionStatus: "disconnected",
  activeBoardId: null,
  collaborators: {},
  lastSeenSequence: null,

  setConnected: connected =>
    set({
      connected,
      connectionStatus: connected ? "connected" : "disconnected"
    }),

  setConnectionStatus: connectionStatus =>
    set({
      connectionStatus,
      connected: connectionStatus === "connected"
    }),

  setActiveBoardId: activeBoardId => set({ activeBoardId }),

  addCollaborator: collaborator =>
    set(state => ({
      collaborators: {
        ...state.collaborators,
        [collaborator.userId]: collaborator
      }
    })),

  removeCollaborator: userId =>
    set(state => {
      const next = { ...state.collaborators };
      delete next[userId];
      return { collaborators: next };
    }),

  setCollaborators: collaborators => set({ collaborators }),

  setLastSeenSequence: lastSeenSequence => set({ lastSeenSequence }),

  resetBoardState: () =>
    set({
      connected: false,
      connectionStatus: "disconnected",
      activeBoardId: null,
      collaborators: {},
      lastSeenSequence: null
    })
}));
