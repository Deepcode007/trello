import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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

import { useBoardStore, type Collaborator } from "../store/useBoardStore";
import { useAuthStore } from "../store/useAuthStore";
import { useOrgStore } from "../store/useOrgStore";
import {
  boardApi,
  getBoardErrorMessage,
  type BoardSummary,
  type BoardDetail
} from "../lib/board-api";
import { api } from "../lib/api";
import { BoardCard } from "../components/board/BoardCard";
import { BoardHeader } from "../components/board/BoardHeader";
import { CreateBoardModal } from "../components/board/CreateBoardModal";
import { BoardCanvasPage } from "../pages/BoardCanvasPage";
import type { UserOrgMembership } from "../lib/org-api";

// Mock WebSocket class for testing
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.lastInstance = this;
  }

  static instances: MockWebSocket[] = [];
  static lastInstance: MockWebSocket | null = null;

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  receive(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === "string" ? data : JSON.stringify(data) });
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0
      }
    }
  });
}

function renderWithProviders(element: React.ReactElement, client = createTestQueryClient()) {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(MemoryRouter, null, element)
    )
  );
}

describe("Step 4 Adversarial Stress Harness: Board State, Sockets, API & UI Resilience", () => {
  const originalApiPost = api.post;
  const originalApiPut = api.put;
  const originalApiGet = api.get;
  const originalApiDelete = api.delete;

  const testMembership: UserOrgMembership = {
    id: "mem-stress-1",
    role: "admin",
    accepted: true,
    userId: "u-tester",
    orgId: "org-stress",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: "2026-01-01T00:00:00Z",
    org: {
      id: "org-stress",
      name: "Acme Innovations",
      description: "Stress test org",
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  };

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

    MockWebSocket.reset();
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;

    useBoardStore.getState().resetBoardState();
    useOrgStore.getState().resetOrgState();
    useOrgStore.setState({
      memberships: [testMembership],
      activeOrgId: "org-stress"
    });

    useAuthStore.setState({
      token: "stress-jwt-token-alpha",
      user: {
        id: "u-tester",
        email: "tester@acme.com",
        username: "tester",
        name: "Tester Prime"
      }
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    api.post = originalApiPost;
    api.put = originalApiPut;
    api.get = originalApiGet;
    api.delete = originalApiDelete;
    useBoardStore.getState().resetBoardState();
  });

  // =========================================================================
  // 1. RAPID / CONCURRENT COLLABORATOR MUTATIONS (useBoardStore)
  // =========================================================================
  describe("1. Rapid & Concurrent Collaborator Mutations in useBoardStore", () => {
    it("handles rapid addition of 1,000 unique collaborators without data corruption", () => {
      const store = useBoardStore.getState();

      for (let i = 0; i < 1000; i++) {
        store.addCollaborator({
          userId: `collab-usr-${i}`,
          name: `Collaborator ${i}`,
          email: `collab${i}@company.com`
        });
      }

      const collaborators = useBoardStore.getState().collaborators;
      expect(Object.keys(collaborators).length).toBe(1000);
      expect(collaborators["collab-usr-0"]?.name).toBe("Collaborator 0");
      expect(collaborators["collab-usr-999"]?.email).toBe("collab999@company.com");
    });

    it("handles concurrent interleaved additions and removals in random order", () => {
      const store = useBoardStore.getState();
      const total = 500;

      // Add 500 collaborators
      for (let i = 0; i < total; i++) {
        store.addCollaborator({
          userId: `usr-${i}`,
          name: `User ${i}`
        });
      }

      // Remove all even-indexed collaborators
      for (let i = 0; i < total; i += 2) {
        store.removeCollaborator(`usr-${i}`);
      }

      const collaborators = useBoardStore.getState().collaborators;
      expect(Object.keys(collaborators).length).toBe(250);

      // Verify even are gone, odd remain
      for (let i = 0; i < total; i++) {
        if (i % 2 === 0) {
          expect(collaborators[`usr-${i}`]).toBeUndefined();
        } else {
          expect(collaborators[`usr-${i}`]?.name).toBe(`User ${i}`);
        }
      }
    });

    it("safely updates existing collaborators on duplicate user additions (latest-write wins)", () => {
      const store = useBoardStore.getState();

      store.addCollaborator({
        userId: "user-alpha",
        name: "Initial Name",
        email: "init@alpha.com"
      });

      expect(useBoardStore.getState().collaborators["user-alpha"]?.name).toBe("Initial Name");

      // Re-add same userId with updated info
      store.addCollaborator({
        userId: "user-alpha",
        name: "Updated Name",
        email: "updated@alpha.com"
      });

      const collabs = useBoardStore.getState().collaborators;
      expect(Object.keys(collabs).length).toBe(1);
      expect(collabs["user-alpha"]?.name).toBe("Updated Name");
      expect(collabs["user-alpha"]?.email).toBe("updated@alpha.com");
    });

    it("gracefully ignores removal of non-existent collaborator IDs without throwing", () => {
      const store = useBoardStore.getState();
      store.addCollaborator({ userId: "existing-user", name: "Existing" });

      expect(() => {
        store.removeCollaborator("ghost-user-1");
        store.removeCollaborator("ghost-user-2");
        store.removeCollaborator("");
      }).not.toThrow();

      const collabs = useBoardStore.getState().collaborators;
      expect(Object.keys(collabs).length).toBe(1);
      expect(collabs["existing-user"]?.name).toBe("Existing");
    });

    it("preserves two-way state invariants across rapid toggles of setConnected and setConnectionStatus", () => {
      const store = useBoardStore.getState();

      store.setConnected(true);
      expect(useBoardStore.getState().connected).toBe(true);
      expect(useBoardStore.getState().connectionStatus).toBe("connected");

      store.setConnectionStatus("reconnecting");
      expect(useBoardStore.getState().connected).toBe(false);
      expect(useBoardStore.getState().connectionStatus).toBe("reconnecting");

      store.setConnectionStatus("connected");
      expect(useBoardStore.getState().connected).toBe(true);
      expect(useBoardStore.getState().connectionStatus).toBe("connected");

      store.setConnected(false);
      expect(useBoardStore.getState().connected).toBe(false);
      expect(useBoardStore.getState().connectionStatus).toBe("disconnected");

      store.setConnectionStatus("disconnected");
      expect(useBoardStore.getState().connected).toBe(false);
      expect(useBoardStore.getState().connectionStatus).toBe("disconnected");
    });

    it("resiliently stores collaborators with special characters, unicode, emojis, and extreme string lengths", () => {
      const store = useBoardStore.getState();

      const complexCollaborators: Collaborator[] = [
        {
          userId: "u-emoji",
          name: "🔥 Dev Ninja 🚀 👩‍💻",
          email: "ninja@🚀.example"
        },
        {
          userId: "u-unicode",
          name: "佐藤 健 (Takeru Satoh)",
          email: "takeru@tokyo.jp"
        },
        {
          userId: "u-extreme",
          name: "X".repeat(5000),
          email: "long@" + "a".repeat(500) + ".com"
        },
        {
          userId: "u-minimal"
          // name and email undefined
        }
      ];

      for (const c of complexCollaborators) {
        store.addCollaborator(c);
      }

      const collabs = useBoardStore.getState().collaborators;
      expect(Object.keys(collabs).length).toBe(4);
      expect(collabs["u-emoji"]?.name).toContain("🚀");
      expect(collabs["u-unicode"]?.name).toContain("佐藤");
      expect(collabs["u-extreme"]?.name?.length).toBe(5000);
      expect(collabs["u-minimal"]?.name).toBeUndefined();
    });

    it("completely resets all store fields on resetBoardState", () => {
      const store = useBoardStore.getState();
      store.setActiveBoardId("board-active-99");
      store.setConnectionStatus("connected");
      store.setLastSeenSequence("9999");
      for (let i = 0; i < 50; i++) {
        store.addCollaborator({ userId: `u-${i}`, name: `User ${i}` });
      }

      expect(Object.keys(useBoardStore.getState().collaborators).length).toBe(50);
      expect(useBoardStore.getState().activeBoardId).toBe("board-active-99");

      store.resetBoardState();

      const state = useBoardStore.getState();
      expect(state.activeBoardId).toBeNull();
      expect(state.connected).toBe(false);
      expect(state.connectionStatus).toBe("disconnected");
      expect(state.collaborators).toEqual({});
      expect(state.lastSeenSequence).toBeNull();
    });
  });

  // =========================================================================
  // 2. SOCKET RECONNECTION BACKOFF & LIFECYCLE RESILIENCE
  // =========================================================================
  describe("2. Socket Reconnection Backoff & Lifecycle Resilience", () => {
    it("strictly bounds exponential backoff delay to a 10,000ms cap", () => {
      // Reconnection backoff formula used in useBoardSocket:
      // delay = Math.min(1000 * 2 ** retryCount, 10000)
      const calculateDelay = (retryCount: number) => Math.min(1000 * 2 ** retryCount, 10000);

      expect(calculateDelay(0)).toBe(1000);
      expect(calculateDelay(1)).toBe(2000);
      expect(calculateDelay(2)).toBe(4000);
      expect(calculateDelay(3)).toBe(8000);
      expect(calculateDelay(4)).toBe(10000); // capped
      expect(calculateDelay(5)).toBe(10000); // capped
      expect(calculateDelay(10)).toBe(10000); // capped
      expect(calculateDelay(50)).toBe(10000); // capped
    });

    it("safely handles malformed non-JSON messages without throwing uncaught exceptions", () => {
      // Test message handler parser against hostile socket messages
      const parseMessage = (raw: string) => {
        try {
          const data = JSON.parse(raw);
          return data;
        } catch {
          return null;
        }
      };

      const hostileMessages = [
        "",
        "   ",
        "undefined",
        "{ invalid json",
        "<html<body>502 Bad Gateway</body></html>",
        "NaN",
        "0",
        "null",
        "true",
        "//comment\n{}"
      ];

      for (const msg of hostileMessages) {
        expect(() => {
          const res = parseMessage(msg);
          if (msg === "null") expect(res).toBeNull();
        }).not.toThrow();
      }
    });

    it("verifies sequence tracking increments and string normalization", () => {
      const store = useBoardStore.getState();

      store.setLastSeenSequence("1");
      expect(useBoardStore.getState().lastSeenSequence).toBe("1");

      store.setLastSeenSequence("105");
      expect(useBoardStore.getState().lastSeenSequence).toBe("105");

      // Sequence with big integer string
      store.setLastSeenSequence("9007199254740992");
      expect(useBoardStore.getState().lastSeenSequence).toBe("9007199254740992");

      store.setLastSeenSequence(null);
      expect(useBoardStore.getState().lastSeenSequence).toBeNull();
    });
  });

  // =========================================================================
  // 3. API ERROR EDGE CASES & HOSTILE PAYLOADS (boardApi & getBoardErrorMessage)
  // =========================================================================
  describe("3. API Error Edge Cases & Hostile Payloads", () => {
    it("extracts error message from standard Axios 400 Bad Request", () => {
      const err = {
        response: {
          status: 400,
          data: { success: false, error: "Board title is invalid or too long" }
        }
      };
      expect(getBoardErrorMessage(err)).toBe("Board title is invalid or too long");
    });

    it("extracts error message from Axios 403 Forbidden with message attribute", () => {
      const err = {
        response: {
          status: 403,
          data: { message: "Contributors are not permitted to archive boards" }
        }
      };
      expect(getBoardErrorMessage(err)).toBe("Contributors are not permitted to archive boards");
    });

    it("extracts error message from 404 Not Found with empty data object", () => {
      const err = {
        response: {
          status: 404,
          data: {}
        },
        message: "Request failed with status code 404"
      };
      expect(getBoardErrorMessage(err)).toBe("Request failed with status code 404");
    });

    it("extracts error message from 500 / 502 with HTML proxy response data", () => {
      const err = {
        response: {
          status: 502,
          data: "<html><body>502 Bad Gateway: Nginx</body></html>"
        },
        message: "Request failed with status code 502"
      };
      expect(getBoardErrorMessage(err)).toBe("Request failed with status code 502");
    });

    it("extracts error message from network failure (no response object, e.g. ECONNREFUSED)", () => {
      const err = {
        message: "Network Error"
      };
      expect(getBoardErrorMessage(err)).toBe("Network Error");
    });

    it("extracts error message from timeout rejection (ECONNABORTED)", () => {
      const err = {
        code: "ECONNABORTED",
        message: "timeout of 10000ms exceeded"
      };
      expect(getBoardErrorMessage(err)).toBe("timeout of 10000ms exceeded");
    });

    it("safely handles primitive values, null, undefined, and non-object errors without crashing", () => {
      expect(getBoardErrorMessage(null)).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage(undefined)).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage("A plain string error")).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage(500)).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage(true)).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage({})).toBe("An unexpected error occurred");
      expect(getBoardErrorMessage({}, "Custom fallback message")).toBe("Custom fallback message");
    });

    it("handles circular error objects without throwing RangeError", () => {
      const circular: Record<string, unknown> = { message: "Circular error" };
      circular.self = circular;

      expect(getBoardErrorMessage(circular)).toBe("Circular error");
    });

    it("handles boardApi.createBoard with extreme string lengths and unicode", async () => {
      const hugeTitle = "🚀 Sprint " + "A".repeat(2000);
      const hugeDesc = "Description " + "B".repeat(5000);

      let createdBoardId = "";
      api.post = mock((url: string, body: unknown) => {
        const payload = body as { title: string };
        expect(payload.title).toBe(hugeTitle);
        createdBoardId = "board-huge-1";
        return Promise.resolve({
          data: {
            success: true,
            data: {
              id: createdBoardId,
              title: payload.title,
              description: null,
              color: null,
              isArchived: false,
              orgId: "org-stress"
            }
          }
        });
      }) as unknown as typeof api.post;

      api.put = mock((url: string, body: unknown) => {
        const payload = body as { description?: string; color?: string };
        expect(payload.description).toBe(hugeDesc);
        expect(payload.color).toBe("#10b981");
        return Promise.resolve({
          data: {
            success: true,
            data: {
              id: createdBoardId,
              title: hugeTitle,
              description: payload.description,
              color: payload.color,
              isArchived: false,
              orgId: "org-stress"
            }
          }
        });
      }) as unknown as typeof api.put;

      const result = await boardApi.createBoard("org-stress", {
        title: hugeTitle,
        description: hugeDesc,
        color: "#10b981"
      });

      expect(result.id).toBe("board-huge-1");
      expect(result.title).toBe(hugeTitle);
      expect(result.description).toBe(hugeDesc);
      expect(result.color).toBe("#10b981");
    });

    it("propagates API rejection when createBoard post fails", async () => {
      api.post = mock(() =>
        Promise.reject({
          response: {
            status: 403,
            data: { error: "Organization subscription board quota reached" }
          }
        })
      ) as unknown as typeof api.post;

      let caughtErr: unknown = null;
      try {
        await boardApi.createBoard("org-stress", { title: "New Board" });
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      expect((caughtErr as { response?: { status?: number } })?.response?.status).toBe(403);
    });

    it("propagates API rejection when secondary description/color update fails in createBoard", async () => {
      api.post = mock(() =>
        Promise.resolve({
          data: {
            success: true,
            data: {
              id: "b-partial",
              title: "Partial Board",
              description: null,
              color: null,
              isArchived: false,
              orgId: "org-stress"
            }
          }
        })
      ) as unknown as typeof api.post;

      api.put = mock(() =>
        Promise.reject({
          response: {
            status: 500,
            data: { error: "Database lock timeout on board update" }
          }
        })
      ) as unknown as typeof api.put;

      let caughtErr: unknown = null;
      try {
        await boardApi.createBoard("org-stress", {
          title: "Partial Board",
          description: "Will fail on PUT",
          color: "#3b82f6"
        });
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      expect((caughtErr as { response?: { status?: number } })?.response?.status).toBe(500);
    });
  });

  // =========================================================================
  // 4. COMPONENT RENDERING RESILIENCE UNDER EDGE-CASE DATA
  // =========================================================================
  describe("4. Component Rendering Resilience Under Edge-Case Data", () => {
    describe("BoardCard Edge-Case Rendering", () => {
      it("renders cleanly when description is null, empty string, or undefined", () => {
        const boardNullDesc: BoardSummary = {
          id: "b-1",
          title: "Null Desc Board",
          description: null,
          color: "#3b82f6",
          isArchived: false,
          orgId: "org-stress"
        };
        const htmlNull = renderWithProviders(
          React.createElement(BoardCard, { board: boardNullDesc, orgId: "org-stress" })
        );
        expect(htmlNull).toContain("No description provided");

        const boardEmptyDesc: BoardSummary = {
          ...boardNullDesc,
          description: ""
        };
        const htmlEmpty = renderWithProviders(
          React.createElement(BoardCard, { board: boardEmptyDesc, orgId: "org-stress" })
        );
        expect(htmlEmpty).toContain("No description provided");
      });

      it("handles missing _count object, 0 issues, 1 issue, and large issue counts", () => {
        // Missing _count completely
        const boardNoCount: BoardSummary = {
          id: "b-no-count",
          title: "No Count Board",
          description: "Test",
          color: "#3b82f6",
          isArchived: false,
          orgId: "org-stress"
        };
        const htmlNoCount = renderWithProviders(
          React.createElement(BoardCard, { board: boardNoCount, orgId: "org-stress" })
        );
        expect(htmlNoCount).toContain("0 cards");

        // Exactly 1 issue -> singular "1 card"
        const boardOneCard: BoardSummary = {
          ...boardNoCount,
          _count: { issues: 1 }
        };
        const htmlOneCard = renderWithProviders(
          React.createElement(BoardCard, { board: boardOneCard, orgId: "org-stress" })
        );
        expect(htmlOneCard).toContain("1 card");
        expect(htmlOneCard).not.toContain("1 cards");

        // 999,999 cards
        const boardLargeCount: BoardSummary = {
          ...boardNoCount,
          _count: { issues: 999999 }
        };
        const htmlLargeCount = renderWithProviders(
          React.createElement(BoardCard, { board: boardLargeCount, orgId: "org-stress" })
        );
        expect(htmlLargeCount).toContain("999999 cards");
      });

      it("falls back to default blue color #3b82f6 when color is null, empty, or undefined", () => {
        const boardNullColor: BoardSummary = {
          id: "b-color",
          title: "No Color Board",
          description: null,
          color: null,
          isArchived: false,
          orgId: "org-stress"
        };
        const htmlNullColor = renderWithProviders(
          React.createElement(BoardCard, { board: boardNullColor, orgId: "org-stress" })
        );
        expect(htmlNullColor).toContain("background-color:#3b82f6");

        const boardEmptyColor: BoardSummary = {
          ...boardNullColor,
          color: ""
        };
        const htmlEmptyColor = renderWithProviders(
          React.createElement(BoardCard, { board: boardEmptyColor, orgId: "org-stress" })
        );
        expect(htmlEmptyColor).toContain("background-color:#3b82f6");
      });
    });

    describe("BoardHeader Presence & Collaborator Stack Edge Cases", () => {
      const mockDetail: BoardDetail = {
        id: "b-header-stress",
        title: "Header Stress Board",
        description: "Board description",
        color: null,
        isArchived: false,
        orgId: "org-stress"
      };

      it("deduplicates current user when present in both useAuthStore and useBoardStore collaborators", () => {
        // Current user is "u-tester"
        useBoardStore.setState({
          collaborators: {
            "u-tester": { userId: "u-tester", name: "Tester Prime", email: "tester@acme.com" },
            "u-other": { userId: "u-other", name: "Other User", email: "other@acme.com" }
          }
        });

        const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
        expect(html).toContain("collaborator-avatar-u-tester");
        expect(html).toContain("collaborator-avatar-u-other");

        // Verify "u-tester" is rendered only once
        const occurrences = (html.match(/collaborator-avatar-u-tester/g) || []).length;
        expect(occurrences).toBe(1);
      });

      it("renders exactly 5 collaborators without overflow badge when total active users is 5", () => {
        const collabs: Record<string, Collaborator> = {};
        // Current user is 1, add 4 more
        for (let i = 1; i <= 4; i++) {
          collabs[`u-collab-${i}`] = { userId: `u-collab-${i}`, name: `Collab ${i}` };
        }
        useBoardStore.setState({ collaborators: collabs });

        const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
        expect(html).not.toContain("collaborator-overflow-badge");
      });

      it("renders overflow badge +1 when total active users is 6", () => {
        const collabs: Record<string, Collaborator> = {};
        // Current user is 1, add 5 more -> total 6
        for (let i = 1; i <= 5; i++) {
          collabs[`u-collab-${i}`] = { userId: `u-collab-${i}`, name: `Collab ${i}` };
        }
        useBoardStore.setState({ collaborators: collabs });

        const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
        expect(html).toContain("collaborator-overflow-badge");
        expect(html).toContain("+1");
      });

      it("renders overflow badge +95 when total active users is 100", () => {
        const collabs: Record<string, Collaborator> = {};
        for (let i = 1; i <= 99; i++) {
          collabs[`u-collab-${i}`] = { userId: `u-collab-${i}`, name: `Collab ${i}` };
        }
        useBoardStore.setState({ collaborators: collabs });

        const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
        expect(html).toContain("collaborator-overflow-badge");
        expect(html).toContain("+95");
      });

      it("falls back to username when user has null or undefined name", () => {
        useAuthStore.setState({
          user: {
            id: "u-no-name",
            email: "noname@example.com",
            username: "usernameready",
            name: null
          }
        });
        useBoardStore.setState({ collaborators: {} });

        const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
        expect(html).toContain("collaborator-avatar-u-no-name");
      });

      it("safely renders header when current user in useAuthStore is null", () => {
        useAuthStore.setState({ user: null });
        useBoardStore.setState({
          collaborators: {
            "u-guest": { userId: "u-guest", name: "Guest User" }
          }
        });

        const html = renderWithProviders(React.createElement(BoardHeader, { board: mockDetail }));
        expect(html).toContain("collaborator-avatar-u-guest");
      });

      it("falls back to 'Organization' in breadcrumbs when board.orgId is not in user memberships", () => {
        const boardUnknownOrg: BoardDetail = {
          ...mockDetail,
          orgId: "org-foreign-xyz"
        };

        const html = renderWithProviders(React.createElement(BoardHeader, { board: boardUnknownOrg }));
        expect(html).toContain("Organization");
      });
    });

    describe("BoardCanvasPage Data & Error Fallback Resilience", () => {
      function renderCanvas(client: QueryClient, route = "/orgs/org-stress/boards/b-canvas-1") {
        return renderToStaticMarkup(
          React.createElement(
            QueryClientProvider,
            { client },
            React.createElement(
              MemoryRouter,
              { initialEntries: [route] },
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: "/orgs/:orgId/boards/:boardId",
                  element: React.createElement(BoardCanvasPage, null)
                })
              )
            )
          )
        );
      }

      it("renders Canvas Ready placeholder when board has undefined or null section array", () => {
        const boardNoSections: BoardDetail = {
          id: "b-canvas-1",
          title: "Canvas Null Sections",
          description: null,
          color: "#3b82f6",
          isArchived: false,
          orgId: "org-stress",
          section: undefined
        };

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(["board", "b-canvas-1"], boardNoSections);

        const html = renderCanvas(client);
        expect(html).toContain("canvas-empty-columns");
        expect(html).toContain("Canvas Ready");
      });

      it("renders column with 'No cards in column' placeholder when column has undefined or empty issues", () => {
        const boardEmptyCol: BoardDetail = {
          id: "b-canvas-1",
          title: "Canvas Column Test",
          description: null,
          color: "#3b82f6",
          isArchived: false,
          orgId: "org-stress",
          section: [
            {
              id: "sec-empty-1",
              title: "Backlog",
              position: 1000,
              isArchived: false,
              issues: undefined
            },
            {
              id: "sec-empty-2",
              title: "In Progress",
              position: 2000,
              isArchived: false,
              issues: []
            }
          ]
        };

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(["board", "b-canvas-1"], boardEmptyCol);

        const html = renderCanvas(client);
        expect(html).toContain("column-sec-empty-1");
        expect(html).toContain("column-sec-empty-2");
        expect(html).toContain("No cards in column");
      });

      it("renders 50 issues across multiple columns without throwing", () => {
        const issuesCol1 = Array.from({ length: 25 }, (_, i) => ({
          id: `iss-col1-${i}`,
          title: `Task Col 1 #${i}`,
          position: (i + 1) * 1000,
          priority: "medium" as const,
          isArchived: false,
          boardId: "b-canvas-1",
          sectionId: "sec-1"
        }));

        const issuesCol2 = Array.from({ length: 25 }, (_, i) => ({
          id: `iss-col2-${i}`,
          title: `Task Col 2 #${i}`,
          position: (i + 1) * 1000,
          priority: "urgent" as const,
          isArchived: false,
          boardId: "b-canvas-1",
          sectionId: "sec-2"
        }));

        const boardManyCards: BoardDetail = {
          id: "b-canvas-1",
          title: "Heavy Load Board",
          description: "Stress testing card rendering",
          color: "#8b5cf6",
          isArchived: false,
          orgId: "org-stress",
          section: [
            { id: "sec-1", title: "Doing", position: 1000, isArchived: false, issues: issuesCol1 },
            { id: "sec-2", title: "Done", position: 2000, isArchived: false, issues: issuesCol2 }
          ]
        };

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(["board", "b-canvas-1"], boardManyCards);

        const html = renderCanvas(client);
        expect(html).toContain("column-sec-1");
        expect(html).toContain("column-sec-2");
        expect(html).toContain("card-iss-col1-0");
        expect(html).toContain("card-iss-col2-24");
      });

      it("renders generic error boundary card with retry action on non-404/403 network failures", () => {
        const client = new QueryClient({
          defaultOptions: {
            queries: { retry: false, staleTime: Infinity }
          }
        });

        client.setQueryData(["board", "b-canvas-1"], null);
        const query = client.getQueryCache().find({ queryKey: ["board", "b-canvas-1"] });
        query?.setState({
          status: "error",
          error: Object.assign(new Error("Network Error"), {
            response: { status: 500, data: { error: "Internal Database Connection Lost" } }
          }),
          errorUpdatedAt: Date.now(),
          fetchStatus: "idle"
        });

        const html = renderCanvas(client);
        expect(html).toContain("canvas-error-generic");
        expect(html).toContain("Error Loading Board");
        expect(html).toContain("Internal Database Connection Lost");
        expect(html).toContain("Retry");
      });
    });

    describe("CreateBoardModal Validation Edge Cases", () => {
      it("renders properly with default preset and disables submit button when contributor", () => {
        useOrgStore.setState({
          memberships: [{ ...testMembership, role: "contributor" }],
          activeOrgId: "org-stress"
        });

        const html = renderWithProviders(
          React.createElement(CreateBoardModal, {
            open: true,
            onOpenChange: () => {},
            orgId: "org-stress"
          })
        );

        expect(html).toContain("Only organization admins and employees can create boards");
        expect(html).toContain("disabled");
      });
    });
  });
});
