import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

export interface ThemeStore {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  initTheme: () => void;
}

const THEME_STORAGE_KEY = "kanban-theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeClass(resolved: "light" | "dark") {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: "system",
  resolvedTheme: "light",

  initTheme: () => {
    let savedTheme: Theme = "system";
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
        if (stored === "light" || stored === "dark" || stored === "system") {
          savedTheme = stored;
        }
      } catch {
        // Ignore localStorage access restrictions
      }
    }

    const resolved = savedTheme === "system" ? getSystemTheme() : savedTheme;
    applyThemeClass(resolved);
    set({ theme: savedTheme, resolvedTheme: resolved });

    // Attach system listener if in browser and theme is system
    if (typeof window !== "undefined" && window.matchMedia) {
      try {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = (e: MediaQueryListEvent) => {
          if (get().theme === "system") {
            const nextResolved = e.matches ? "dark" : "light";
            applyThemeClass(nextResolved);
            set({ resolvedTheme: nextResolved });
          }
        };
        if (typeof mediaQuery.addEventListener === "function") {
          mediaQuery.addEventListener("change", handleChange);
        } else if (typeof (mediaQuery as unknown as { addListener?: (cb: unknown) => void }).addListener === "function") {
          (mediaQuery as unknown as { addListener: (cb: unknown) => void }).addListener(handleChange);
        }
      } catch {
        // Fallback for older test environments
      }
    }

    // Attach multi-tab storage synchronization listener
    if (typeof window !== "undefined" && window.addEventListener) {
      try {
        const handleStorage = (e: StorageEvent) => {
          if (e.key === THEME_STORAGE_KEY && e.newValue) {
            const nextTheme = e.newValue as Theme;
            if (nextTheme === "light" || nextTheme === "dark" || nextTheme === "system") {
              const nextResolved = nextTheme === "system" ? getSystemTheme() : nextTheme;
              applyThemeClass(nextResolved);
              set({ theme: nextTheme, resolvedTheme: nextResolved });
            }
          }
        };
        window.addEventListener("storage", handleStorage);
      } catch {
        // Fallback for mock environments
      }
    }
  },

  setTheme: (newTheme: Theme) => {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // Ignore localStorage errors
      }
    }

    const resolved = newTheme === "system" ? getSystemTheme() : newTheme;
    applyThemeClass(resolved);
    set({ theme: newTheme, resolvedTheme: resolved });
  },

  toggleTheme: () => {
    const current = get().resolvedTheme;
    const nextTheme: Theme = current === "dark" ? "light" : "dark";
    get().setTheme(nextTheme);
  }
}));
