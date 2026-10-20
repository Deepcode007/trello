import { describe, it, expect } from "bun:test";
import fs from "fs";
import path from "path";

describe("Theme and Popover Configuration Suite", () => {
  it("verifies index.css defines --popover, --popover-foreground, and explicit utility classes", () => {
    const cssPath = path.resolve(__dirname, "../index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    expect(css).toContain("--popover:");
    expect(css).toContain("--popover-foreground:");

    // Verify .dark section defines dark popover values
    const darkSection = css.split(".dark")[1];
    expect(darkSection).toBeDefined();
    expect(darkSection).toContain("--popover:");
    expect(darkSection).toContain("--popover-foreground:");

    // Verify explicit utilities exist for hot-module replacement compatibility
    expect(css).toContain(".bg-popover");
    expect(css).toContain(".text-popover-foreground");
  });

  it("verifies tailwind.config.js includes popover color mappings", () => {
    const configPath = path.resolve(__dirname, "../../tailwind.config.js");
    const config = fs.readFileSync(configPath, "utf-8");

    expect(config).toContain("popover:");
    expect(config).toContain('"hsl(var(--popover))"');
    expect(config).toContain('"hsl(var(--popover-foreground))"');
  });

  it("verifies dropdown-menu.tsx uses solid background classes and avoids hardcoded bg-white", () => {
    const dropdownPath = path.resolve(__dirname, "../components/ui/dropdown-menu.tsx");
    const dropdown = fs.readFileSync(dropdownPath, "utf-8");

    expect(dropdown).toContain("bg-card");
    expect(dropdown).toContain("text-card-foreground");
    expect(dropdown).toContain("bg-popover");
    expect(dropdown).toContain("text-popover-foreground");
    expect(dropdown).not.toContain("bg-white");
  });

  it("verifies theme-toggle.tsx includes solid background classes on DropdownMenuContent", () => {
    const togglePath = path.resolve(__dirname, "../components/ui/theme-toggle.tsx");
    const toggle = fs.readFileSync(togglePath, "utf-8");

    expect(toggle).toContain("bg-card");
    expect(toggle).toContain("text-card-foreground");
  });
});
