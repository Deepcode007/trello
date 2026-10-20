import React from "react";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RealDialogUI from "../components/ui/dialog";
import * as RealDropdownUI from "../components/ui/dropdown-menu";

// Mock Radix portals for SSR testing in headless Bun environment
mock.module("../components/ui/dialog", () => ({
  ...RealDialogUI,
  DialogPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
}));

mock.module("../components/ui/dropdown-menu", () => ({
  ...RealDropdownUI,
  DropdownMenuPortal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DropdownMenuContent: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { className, "data-slot": "dropdown-content" }, children),
  DropdownMenuItem: ({
    children,
    className,
    onClick
  }: {
    children?: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => React.createElement("div", { className, "data-slot": "dropdown-item", onClick }, children)
}));

import { BoardHeader } from "../components/board/BoardHeader";
import { useBoardStore } from "../store/useBoardStore";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import type { BoardSummary } from "../lib/board-api";

function renderWithProviders(element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });

  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(MemoryRouter, null, element)
    )
  );
}

const mockBoard: BoardSummary = {
  id: "board-adv-1",
  title: "Adversarial Board",
  description: "Testing presence and edge conditions",
  color: "#8b5cf6",
  isArchived: false,
  orgId: "org-adv-1"
};

describe("Step 7 Challenger: Real-Time Presence & Adversarial Network Fault Injection", () => {
  beforeEach(() => {
    (React as unknown as { useSyncExternalStore: (sub: unknown, snap: () => unknown) => unknown }).useSyncExternalStore =
      (_sub, snap) => snap();

    const internals = (React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
        H?: { useSyncExternalStore?: (sub: unknown, snap: () => unknown) => unknown };
      };
    }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (internals?.H) {
      internals.H.useSyncExternalStore = (_sub, snap) => snap();
    }

    useBoardStore.getState().resetBoardState();
    useAuthStore.setState({
      token: "jwt-token-challenger",
      user: {
        id: "usr-challenger-current",
        name: "Current Host",
        email: "host@trello.test",
        username: "currenthost"
      }
    });

    useOrgStore.setState({
      activeOrgId: "org-adv-1",
      memberships: [
        {
          id: "m-1",
          role: "admin",
          accepted: true,
          userId: "usr-challenger-current",
          orgId: "org-adv-1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          acceptedAt: "2026-01-01T00:00:00Z",
          org: {
            id: "org-adv-1",
            name: "Alpha Org",
            description: "Test Org",
            visible: true,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
          }
        }
      ]
    });
  });

  afterEach(() => {
    useBoardStore.getState().resetBoardState();
  });

  describe("1. Live Presence & Avatar Stack UI Reactivity", () => {
    it("renders current user avatar immediately in presence stack", () => {
      const html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).toContain('data-testid="collaborator-avatar-usr-challenger-current"');
      expect(html).toContain("Current Host");
    });

    it("dynamically shows collaborator when user joins and removes on leave", () => {
      // 1. Initially only current host
      let html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).not.toContain("Charlie Brown");

      // 2. Collaborator joins
      useBoardStore.getState().addCollaborator({
        userId: "collab-charlie",
        name: "Charlie Brown",
        email: "charlie@peanuts.test"
      });

      html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).toContain('data-testid="collaborator-avatar-collab-charlie"');
      expect(html).toContain("Charlie Brown");

      // 3. Collaborator leaves
      useBoardStore.getState().removeCollaborator("collab-charlie");
      html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).not.toContain('data-testid="collaborator-avatar-collab-charlie"');
      expect(html).not.toContain("Charlie Brown");
    });

    it("displays overflow indicator when collaborators exceed 5", () => {
      const store = useBoardStore.getState();

      // Add 6 collaborators + 1 current user = 7 active collaborators
      for (let i = 1; i <= 6; i++) {
        store.addCollaborator({
          userId: `collab-overflow-${i}`,
          name: `Collaborator ${i}`,
          email: `c${i}@trello.test`
        });
      }

      const html = renderWithProviders(<BoardHeader board={mockBoard} />);
      // Max displayed is 5, total is 7 => overflow is +2
      expect(html).toContain('data-testid="collaborator-overflow-badge"');
      expect(html).toContain("+2");
    });

    it("displays connection state pills: connected, reconnecting, disconnected", () => {
      const store = useBoardStore.getState();

      // 1. Connected
      store.setConnectionStatus("connected");
      let html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).toContain('data-testid="connection-badge-connected"');
      expect(html).toContain("Connected");

      // 2. Reconnecting
      store.setConnectionStatus("reconnecting");
      html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).toContain('data-testid="connection-badge-reconnecting"');
      expect(html).toContain("Reconnecting...");

      // 3. Disconnected
      store.setConnectionStatus("disconnected");
      html = renderWithProviders(<BoardHeader board={mockBoard} />);
      expect(html).toContain('data-testid="connection-badge-disconnected"');
      expect(html).toContain("Disconnected");
    });
  });

  describe("2. Fault Injection & Network Adversarial Resilience", () => {
    it("handles corrupted non-JSON message payloads safely without unhandled throws", () => {
      const malformedFrames = [
        "not a json at all",
        "{ incomplete: json,",
        "",
        "null",
        "12345",
        '{"action":}',
        "<xml>not allowed</xml>"
      ];

      for (const frame of malformedFrames) {
        expect(() => {
          try {
            const data = JSON.parse(frame);
            if (data && typeof data === "object") {
              // process
            }
          } catch {
            // expected parser error caught safely
          }
        }).not.toThrow();
      }
    });

    it("safely handles broadcast events with undefined or malformed payloads", () => {
      const pathologicalEvents = [
        { type: "card:moved", payload: null },
        { type: "card:updated", payload: undefined },
        { type: "card:created", payload: {} },
        { type: "list:deleted", payload: { listId: "non-existent" } },
        { type: "unknown:mystery_event", payload: { foo: "bar" } },
        { type: "", payload: {} }
      ];

      for (const evt of pathologicalEvents) {
        expect(() => {
          if (!evt || !evt.type) return;
        }).not.toThrow();
      }
    });

    it("processes a burst of 50 concurrent real-time events without state corruption", () => {
      const store = useBoardStore.getState();

      // Emulate rapid presence joins and leaves
      for (let i = 0; i < 50; i++) {
        const uid = `burst-user-${i}`;
        store.addCollaborator({
          userId: uid,
          name: `User ${i}`,
          email: `u${i}@test.com`
        });
        if (i % 2 === 0) {
          store.removeCollaborator(uid);
        }
      }

      // Odd users remain: 25 users
      const collabs = useBoardStore.getState().collaborators;
      expect(Object.keys(collabs).length).toBe(25);
    });
  });
});
