import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "";
export const WS_BASE_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

let onUnauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorizedCallback = cb;
}

api.interceptors.request.use(config => {
  const token = typeof window !== "undefined" && window.localStorage ? localStorage.getItem("token") : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      const url = error.config?.url || "";
      // Exclude standard credential verification rejections from session logout
      const isAuthAttempt = url.includes("/api/auth/login") || url.includes("/api/auth/signup");
      if (!isAuthAttempt) {
        if (typeof window !== "undefined" && window.localStorage) {
          localStorage.removeItem("token");
        }
        if (onUnauthorizedCallback) {
          onUnauthorizedCallback();
        } else if (typeof window !== "undefined" && window.location) {
          const currentPath = window.location.pathname + window.location.search;
          if (!window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/signup")) {
            const redirectParam = currentPath !== "/" ? `?redirect=${encodeURIComponent(currentPath)}` : "";
            window.location.href = `/login${redirectParam}`;
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

