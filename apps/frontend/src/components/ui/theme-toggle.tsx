import React from "react";
import { Sun, Moon, Laptop } from "lucide-react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from "./dropdown-menu";
import { useThemeStore } from "../../store/useThemeStore";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore(s => s.theme);
  const resolvedTheme = useThemeStore(s => s.resolvedTheme);
  const setTheme = useThemeStore(s => s.setTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid="theme-toggle-button"
          aria-label={`Current theme: ${theme}. Toggle theme.`}
          className={`h-8 w-8 p-0 shrink-0 ${className || ""}`}
        >
          {resolvedTheme === "dark" ? (
            <Moon className="h-4 w-4 text-primary transition-transform hover:-rotate-12" />
          ) : (
            <Sun className="h-4 w-4 text-amber-500 transition-transform hover:rotate-45" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 bg-card text-card-foreground" data-testid="theme-dropdown-content">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          data-testid="theme-option-light"
          className="gap-2 cursor-pointer text-xs"
        >
          <Sun className="h-3.5 w-3.5 text-amber-500" />
          <span>Light</span>
          {theme === "light" && <span className="ml-auto text-primary font-bold">✓</span>}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          data-testid="theme-option-dark"
          className="gap-2 cursor-pointer text-xs"
        >
          <Moon className="h-3.5 w-3.5 text-primary" />
          <span>Dark</span>
          {theme === "dark" && <span className="ml-auto text-primary font-bold">✓</span>}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setTheme("system")}
          data-testid="theme-option-system"
          className="gap-2 cursor-pointer text-xs"
        >
          <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
          <span>System</span>
          {theme === "system" && <span className="ml-auto text-primary font-bold">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
