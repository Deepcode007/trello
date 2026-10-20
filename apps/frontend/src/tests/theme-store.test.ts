import { describe, it, expect, beforeEach } from "bun:test";
import { useThemeStore } from "../store/useThemeStore";

describe("Step 8: Theme & Dark Mode Store Suite", () => {
  beforeEach(() => {
    // Reset document element class list if mock document exists
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.className = "";
    }
    useThemeStore.setState({ theme: "system", resolvedTheme: "light" });
  });

  it("initializes with default system theme", () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe("system");
    expect(state.resolvedTheme === "light" || state.resolvedTheme === "dark").toBe(true);
  });

  it("sets theme to dark and applies 'dark' class to documentElement", () => {
    useThemeStore.getState().setTheme("dark");
    const state = useThemeStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.resolvedTheme).toBe("dark");

    if (typeof document !== "undefined" && document.documentElement) {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    }
  });

  it("sets theme to light and removes 'dark' class from documentElement", () => {
    // First set to dark
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");

    // Then set to light
    useThemeStore.getState().setTheme("light");
    const state = useThemeStore.getState();
    expect(state.theme).toBe("light");
    expect(state.resolvedTheme).toBe("light");

    if (typeof document !== "undefined" && document.documentElement) {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    }
  });

  it("toggleTheme switches between light and dark", () => {
    useThemeStore.getState().setTheme("light");
    expect(useThemeStore.getState().resolvedTheme).toBe("light");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
  });

  it("initTheme reads persisted theme from localStorage", () => {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem("kanban-theme", "dark");
      useThemeStore.getState().initTheme();

      expect(useThemeStore.getState().theme).toBe("dark");
      expect(useThemeStore.getState().resolvedTheme).toBe("dark");

      // Cleanup
      localStorage.removeItem("kanban-theme");
    }
  });

  it("synchronizes theme when receiving cross-tab storage events", () => {
    if (typeof window !== "undefined" && window.dispatchEvent) {
      useThemeStore.getState().initTheme();
      useThemeStore.getState().setTheme("light");

      const event = new StorageEvent("storage", {
        key: "kanban-theme",
        newValue: "dark"
      });
      window.dispatchEvent(event);

      expect(useThemeStore.getState().theme).toBe("dark");
      expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    }
  });
});
