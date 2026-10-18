import { create } from "zustand";
import { api } from "../lib/api";

export interface User {
  id: string;
  email: string;
  username?: string;
  name?: string | null;
  avatarUrl?: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  setToken: (token: string) => void;
  logout: () => void;
  loadUser: () => Promise<void>;
}

function parseJwt(token: string): { id: string; email: string } | null {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("token"),
  user: null,
  isLoading: true,

  setToken: (token: string) => {
    localStorage.setItem("token", token);
    const decoded = parseJwt(token);
    set({
      token,
      user: decoded ? { id: decoded.id, email: decoded.email } : null
    });
    get().loadUser();
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ token: null, user: null, isLoading: false });
  },

  loadUser: async () => {
    const token = get().token;
    if (!token) {
      set({ user: null, isLoading: false });
      return;
    }

    const decoded = parseJwt(token);
    try {
      const res = await api.get("/api/users/me");
      if (res.data?.success && res.data.data) {
        set({
          user: {
            id: res.data.data.id || decoded?.id || "",
            email: res.data.data.email || decoded?.email || "",
            username: res.data.data.username,
            name: res.data.data.name,
            avatarUrl: res.data.data.avatarUrl
          },
          isLoading: false
        });
        return;
      }
    } catch {
      // If profile request fails but token was decodable, retain decoded identity
      if (decoded) {
        set({
          user: { id: decoded.id, email: decoded.email },
          isLoading: false
        });
        return;
      }
    }

    set({ isLoading: false });
  }
}));
