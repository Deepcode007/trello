import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import
{
    handleWebSocketClose,
    handleWebSocketMessage,
    handleUpgradeRequest,
    notifyUserSockets,
    userSocketRegistry,
    createWebSocketServer,
    setBoardAccessChecker,
    resetBoardAccessChecker
} from "../src/server";
import { type WebSocketData, formatUserTopic, cleanUserId } from "../src/types/events";
import { wsBroadcaster } from "../src/services/broadcaster";
import { env } from "../src/env";
import jwt from "jsonwebtoken";

const JWT_SECRET = env.INTERNAL_BROADCAST_SECRET || env.jwt_key || "test-jwt-secret";

describe("Phase 3: WebSocket Extension — User Topics Delivery", () =>
{
    function createMockSocket(userId = "user_100", email = "alice@test.com", name = "Alice")
    {
        const subscriptions = new Set<string>();
        const sentMessages: string[] = [];
        const subscribedTopics: string[] = [];
        const unsubscribedTopics: string[] = [];

        const ws = {
            data: {
                userId,
                email,
                name,
                subscriptions,
                connectedAt: Date.now(),
                isAlive: true,
                lastPing: Date.now(),
                lastPong: Date.now()
            } as WebSocketData,
            subscribe: mock((topic: string) =>
            {
                subscribedTopics.push(topic);
                return true;
            }),
            unsubscribe: mock((topic: string) =>
            {
                unsubscribedTopics.push(topic);
                return true;
            }),
            send: mock((msg: string) =>
            {
                sentMessages.push(msg);
                return 1;
            }),
            close: mock((_code?: number, _reason?: string) =>
            {
                return true;
            }),
            getSentMessages()
            {
                return sentMessages;
            },
            getSubscribedTopics()
            {
                return subscribedTopics;
            },
            getUnsubscribedTopics()
            {
                return unsubscribedTopics;
            }
        };

        return ws;
    }

    function createMockServer()
    {
        const publishedEvents: { topic: string; message: string }[] = [];
        const server = {
            publish: mock((topic: string, message: string) =>
            {
                publishedEvents.push({ topic, message });
                return 1;
            }),
            getPublishedEvents()
            {
                return publishedEvents;
            }
        };
        return server;
    }

    beforeEach(() =>
    {
        userSocketRegistry.clear();
        setBoardAccessChecker(() => true);
    });

    afterEach(() =>
    {
        userSocketRegistry.clear();
        resetBoardAccessChecker();
    });

    // -------------------------------------------------------------
    // Helper Tests
    // -------------------------------------------------------------
    describe("Topic Helper Functions", () =>
    {
        it("formatUserTopic formats user topics consistently as user_<userId>", () =>
        {
            expect(formatUserTopic("123")).toBe("user_123");
            expect(formatUserTopic("userA")).toBe("user_userA");
            expect(formatUserTopic("   userB   ")).toBe("user_userB");
        });

        it("formatUserTopic returns empty string for empty, whitespace, or invalid inputs", () =>
        {
            expect(formatUserTopic("")).toBe("");
            expect(formatUserTopic("   ")).toBe("");
            expect(formatUserTopic(null as any)).toBe("");
            expect(formatUserTopic(undefined as any)).toBe("");
        });

        it("cleanUserId strips leading user_ prefix", () =>
        {
            expect(cleanUserId("user_123")).toBe("123");
            expect(cleanUserId("user_userA")).toBe("userA");
            expect(cleanUserId("123")).toBe("123");
        });

        it("cleanUserId returns empty string for empty, whitespace, or invalid inputs", () =>
            {
            expect(cleanUserId("")).toBe("");
            expect(cleanUserId("   ")).toBe("");
            expect(cleanUserId(null as any)).toBe("");
            expect(cleanUserId(undefined as any)).toBe("");
        });
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 1: subscribe_user subscribes socket to user_<userId> topic
    // -------------------------------------------------------------
    it("1. subscribe_user subscribes socket to user_<userId> topic and acknowledges", async () =>
    {
        const ws = createMockSocket("user_456", "bob@test.com", "Bob");
        const server = createMockServer();

        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "subscribe_user"
        }));

        expect(ws.subscribe).toHaveBeenCalledWith("user_user_456");
        expect(ws.data.subscriptions.has("user_user_456")).toBe(true);

        const messages = ws.getSentMessages().map(m => JSON.parse(m));
        expect(messages.length).toBe(1);
        expect(messages[0].type).toBe("user_subscribed");
        expect(messages[0].userId).toBe("user_456");
        expect(messages[0].topic).toBe("user_user_456");

        // Socket is tracked in userSocketRegistry
        const registered = userSocketRegistry.get("user_456");
        expect(registered).toBeDefined();
        expect(registered?.has(ws as any)).toBe(true);
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 2: POST /internal/notify-users delivers event to subscribed user
    // -------------------------------------------------------------
    it("2. POST /internal/notify-users delivers event to subscribed user", async () =>
    {
        const ws = createMockSocket("user_789", "carol@test.com", "Carol");
        const server = createMockServer();

        // 1. Socket subscribes to user topic
        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "subscribe_user"
        }));

        const notificationEvent = {
            type: "user:notification",
            payload: {
                notification: {
                    id: "notif-001",
                    type: "org:invitation_received",
                    data: { orgId: "org-1", orgName: "Acme Corp" },
                    createdAt: new Date().toISOString()
                }
            }
        };

        // 2. Dispatch IPC request
        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_789"],
                event: notificationEvent
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(200);

        const json = await res?.json() as { success: boolean; recipientCount: number };
        expect(json.success).toBe(true);
        expect(json.recipientCount).toBe(1);

        // Server published to user topic
        expect(server.publish).toHaveBeenCalledWith("user_user_789", JSON.stringify(notificationEvent));

        // Socket received the notification
        const messages = ws.getSentMessages().map(m => JSON.parse(m));
        const receivedNotification = messages.find(m => m.type === "user:notification");
        expect(receivedNotification).toBeDefined();
        expect(receivedNotification.payload.notification.id).toBe("notif-001");
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 3: /internal/notify-users handles user with no active sockets without error
    // -------------------------------------------------------------
    it("3. POST /internal/notify-users handles user with no active sockets (offline) without error", async () =>
    {
        const server = createMockServer();

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_completely_offline"],
                event: {
                    type: "user:notification",
                    payload: { notification: { id: "notif-offline", type: "org:role_changed" } }
                }
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(200);

        const json = await res?.json() as { success: boolean; recipientCount: number };
        expect(json.success).toBe(true);
        expect(json.recipientCount).toBe(0);
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 4: Event is delivered to multiple sockets for the same user (multi-tab)
    // -------------------------------------------------------------
    it("4. Event is delivered to multiple sockets for the same user (multi-tab)", async () =>
    {
        const server = createMockServer();
        const tab1 = createMockSocket("user_multitab", "multi@test.com", "Multi Tab 1");
        const tab2 = createMockSocket("user_multitab", "multi@test.com", "Multi Tab 2");
        const tab3 = createMockSocket("user_multitab", "multi@test.com", "Multi Tab 3");

        // All three tabs subscribe to user topic
        await handleWebSocketMessage(tab1, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab2, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab3, server, JSON.stringify({ action: "subscribe_user" }));

        expect(userSocketRegistry.get("user_multitab")?.size).toBe(3);

        const event = {
            type: "user:notification",
            payload: { notification: { id: "notif-tabs", type: "org:member_removed" } }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_multitab"],
                event
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);
        const json = await res?.json() as { success: boolean; recipientCount: number };
        expect(json.recipientCount).toBe(3);

        // All three tabs received the notification
        const tab1Msgs = tab1.getSentMessages().map(m => JSON.parse(m));
        const tab2Msgs = tab2.getSentMessages().map(m => JSON.parse(m));
        const tab3Msgs = tab3.getSentMessages().map(m => JSON.parse(m));

        expect(tab1Msgs.some(m => m.type === "user:notification")).toBe(true);
        expect(tab2Msgs.some(m => m.type === "user:notification")).toBe(true);
        expect(tab3Msgs.some(m => m.type === "user:notification")).toBe(true);
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 5: User topic remains subscribed when board topic is unsubscribed
    // -------------------------------------------------------------
    it("5. User topic remains subscribed when board topic is unsubscribed (board leave)", async () =>
    {
        const ws = createMockSocket("user_persists", "persist@test.com", "Persist");
        const server = createMockServer();

        // 1. Subscribe to user topic
        await handleWebSocketMessage(ws, server, JSON.stringify({ action: "subscribe_user" }));
        expect(ws.data.subscriptions.has("user_user_persists")).toBe(true);

        // 2. Join board
        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "board_alpha"
        }));
        expect(ws.data.subscriptions.has("board_alpha")).toBe(true);

        // Socket has both subscriptions
        expect(ws.data.subscriptions.size).toBe(2);

        // 3. Leave board
        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "leave",
            boardId: "board_alpha"
        }));

        // Board subscription is removed, but user topic remains active
        expect(ws.data.subscriptions.has("board_alpha")).toBe(false);
        expect(ws.data.subscriptions.has("user_user_persists")).toBe(true);

        // 4. User notification still delivered to this socket
        const event = {
            type: "user:notification",
            payload: { notification: { id: "notif-post-leave" } }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_persists"],
                event
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const msgs = ws.getSentMessages().map(m => JSON.parse(m));
        expect(msgs.some(m => m.payload?.notification?.id === "notif-post-leave")).toBe(true);
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 6: Socket eviction / cleanup removes user topic subscription
    // -------------------------------------------------------------
    it("6. Socket close and eviction cleans up user topic subscription", async () =>
    {
        const ws = createMockSocket("user_evict_test", "evict@test.com", "Evict Me");
        const server = createMockServer();

        await handleWebSocketMessage(ws, server, JSON.stringify({ action: "subscribe_user" }));
        expect(ws.data.subscriptions.has("user_user_evict_test")).toBe(true);
        expect(userSocketRegistry.get("user_evict_test")?.size).toBe(1);

        // Trigger socket close
        handleWebSocketClose(ws, server, 1000, "Normal closure");

        // Subscriptions set cleared
        expect(ws.data.subscriptions.size).toBe(0);
        expect(ws.unsubscribe).toHaveBeenCalledWith("user_user_evict_test");

        // Removed from registry
        expect(userSocketRegistry.get("user_evict_test")).toBeUndefined();

        // Subsequent notification does not reach closed socket
        const event = {
            type: "user:notification",
            payload: { notification: { id: "notif-after-close" } }
        };

        const result = notifyUserSockets(server, ["user_evict_test"], event);
        expect(result.recipientCount).toBe(0);

        const msgs = ws.getSentMessages().map(m => JSON.parse(m));
        expect(msgs.some(m => m.payload?.notification?.id === "notif-after-close")).toBe(false);
    });

    // -------------------------------------------------------------
    // Scenario 7: User isolation (userA does not receive userB's notification)
    // -------------------------------------------------------------
    it("7. User isolation: notify userA delivers to userA but NOT userB", async () =>
    {
        const server = createMockServer();
        const wsA = createMockSocket("user_A", "a@test.com", "Alice");
        const wsB = createMockSocket("user_B", "b@test.com", "Bob");

        await handleWebSocketMessage(wsA, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(wsB, server, JSON.stringify({ action: "subscribe_user" }));

        const event = {
            type: "user:notification",
            payload: { notification: { id: "only-for-alice" } }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_A"],
                event
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const aMsgs = wsA.getSentMessages().map(m => JSON.parse(m));
        const bMsgs = wsB.getSentMessages().map(m => JSON.parse(m));

        expect(aMsgs.some(m => m.payload?.notification?.id === "only-for-alice")).toBe(true);
        expect(bMsgs.some(m => m.payload?.notification?.id === "only-for-alice")).toBe(false);
    });

    // -------------------------------------------------------------
    // Scenario 8: Multiple users notified in single IPC call
    // -------------------------------------------------------------
    it("8. Multi-recipient IPC delivers to all specified users simultaneously", async () =>
    {
        const server = createMockServer();
        const wsA = createMockSocket("user_1", "1@test.com", "User 1");
        const wsB = createMockSocket("user_2", "2@test.com", "User 2");
        const wsC = createMockSocket("user_3", "3@test.com", "User 3");

        await handleWebSocketMessage(wsA, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(wsB, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(wsC, server, JSON.stringify({ action: "subscribe_user" }));

        const event = {
            type: "user:notification",
            payload: { notification: { id: "broadcast-to-1-and-2" } }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_1", "user_2"],
                event
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const aMsgs = wsA.getSentMessages().map(m => JSON.parse(m));
        const bMsgs = wsB.getSentMessages().map(m => JSON.parse(m));
        const cMsgs = wsC.getSentMessages().map(m => JSON.parse(m));

        expect(aMsgs.some(m => m.payload?.notification?.id === "broadcast-to-1-and-2")).toBe(true);
        expect(bMsgs.some(m => m.payload?.notification?.id === "broadcast-to-1-and-2")).toBe(true);
        expect(cMsgs.some(m => m.payload?.notification?.id === "broadcast-to-1-and-2")).toBe(false);
    });

    // -------------------------------------------------------------
    // Scenario 9: user:org_board_created delivery to multi-tab users
    // -------------------------------------------------------------
    it("9. POST /internal/notify-users delivers user:org_board_created to multiple tabs", async () =>
    {
        const server = createMockServer();
        const tab1 = createMockSocket("user_tab", "tab@test.com", "Tab User");
        const tab2 = createMockSocket("user_tab", "tab@test.com", "Tab User");

        await handleWebSocketMessage(tab1, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab2, server, JSON.stringify({ action: "subscribe_user" }));

        const boardCreatedEvent = {
            type: "user:org_board_created",
            payload: {
                orgId: "org-test-1",
                board: {
                    id: "board-new-1",
                    title: "Brand New Board",
                    columnCount: 0
                }
            }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_tab"],
                event: boardCreatedEvent
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const tab1Msgs = tab1.getSentMessages().map(m => JSON.parse(m));
        const tab2Msgs = tab2.getSentMessages().map(m => JSON.parse(m));

        expect(tab1Msgs.some(m => m.type === "user:org_board_created" && m.payload.board.id === "board-new-1")).toBe(true);
        expect(tab2Msgs.some(m => m.type === "user:org_board_created" && m.payload.board.id === "board-new-1")).toBe(true);
    });

    // -------------------------------------------------------------
    // Scenario 10: user:org_board_columns_changed delivery to multi-tab users
    // -------------------------------------------------------------
    it("10. POST /internal/notify-users delivers user:org_board_columns_changed to multiple tabs", async () =>
    {
        const server = createMockServer();
        const tab1 = createMockSocket("user_cols", "cols@test.com", "Cols User");
        const tab2 = createMockSocket("user_cols", "cols@test.com", "Cols User");

        await handleWebSocketMessage(tab1, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab2, server, JSON.stringify({ action: "subscribe_user" }));

        const columnsChangedEvent = {
            type: "user:org_board_columns_changed",
            payload: {
                orgId: "org-test-1",
                boardId: "board-100",
                columnCount: 5
            }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_cols"],
                event: columnsChangedEvent
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const tab1Msgs = tab1.getSentMessages().map(m => JSON.parse(m));
        const tab2Msgs = tab2.getSentMessages().map(m => JSON.parse(m));

        expect(tab1Msgs.some(m => m.type === "user:org_board_columns_changed" && m.payload.columnCount === 5)).toBe(true);
        expect(tab2Msgs.some(m => m.type === "user:org_board_columns_changed" && m.payload.columnCount === 5)).toBe(true);
    });

    // -------------------------------------------------------------
    // Scenario 11: user:org_board_deleted delivery to multi-tab users
    // -------------------------------------------------------------
    it("11. POST /internal/notify-users delivers user:org_board_deleted to multiple tabs", async () =>
    {
        const server = createMockServer();
        const tab1 = createMockSocket("user_del", "del@test.com", "Del User");
        const tab2 = createMockSocket("user_del", "del@test.com", "Del User");

        await handleWebSocketMessage(tab1, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab2, server, JSON.stringify({ action: "subscribe_user" }));

        const boardDeletedEvent = {
            type: "user:org_board_deleted",
            payload: {
                orgId: "org-test-1",
                boardId: "board-to-delete"
            }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_del"],
                event: boardDeletedEvent
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const tab1Msgs = tab1.getSentMessages().map(m => JSON.parse(m));
        const tab2Msgs = tab2.getSentMessages().map(m => JSON.parse(m));

        expect(tab1Msgs.some(m => m.type === "user:org_board_deleted" && m.payload.boardId === "board-to-delete")).toBe(true);
        expect(tab2Msgs.some(m => m.type === "user:org_board_deleted" && m.payload.boardId === "board-to-delete")).toBe(true);
    });

    // -------------------------------------------------------------
    // Scenario 12: user:org_board_cards_changed delivery to multi-tab users
    // -------------------------------------------------------------
    it("12. POST /internal/notify-users delivers user:org_board_cards_changed to multiple tabs", async () =>
    {
        const server = createMockServer();
        const tab1 = createMockSocket("user_cards", "cards@test.com", "Cards User");
        const tab2 = createMockSocket("user_cards", "cards@test.com", "Cards User");

        await handleWebSocketMessage(tab1, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab2, server, JSON.stringify({ action: "subscribe_user" }));

        const cardsChangedEvent = {
            type: "user:org_board_cards_changed",
            payload: {
                orgId: "org-test-1",
                boardId: "board-101",
                cardCount: 7
            }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_cards"],
                event: cardsChangedEvent
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const tab1Msgs = tab1.getSentMessages().map(m => JSON.parse(m));
        const tab2Msgs = tab2.getSentMessages().map(m => JSON.parse(m));

        expect(tab1Msgs.some(m => m.type === "user:org_board_cards_changed" && m.payload.cardCount === 7)).toBe(true);
        expect(tab2Msgs.some(m => m.type === "user:org_board_cards_changed" && m.payload.cardCount === 7)).toBe(true);
    });

    // -------------------------------------------------------------
    // Scenario 13: user:org_board_updated delivery to multi-tab users
    // -------------------------------------------------------------
    it("13. POST /internal/notify-users delivers user:org_board_updated to multiple tabs", async () =>
    {
        const server = createMockServer();
        const tab1 = createMockSocket("user_upd", "upd@test.com", "Upd User");
        const tab2 = createMockSocket("user_upd", "upd@test.com", "Upd User");

        await handleWebSocketMessage(tab1, server, JSON.stringify({ action: "subscribe_user" }));
        await handleWebSocketMessage(tab2, server, JSON.stringify({ action: "subscribe_user" }));

        const boardUpdatedEvent = {
            type: "user:org_board_updated",
            payload: {
                orgId: "org-test-1",
                boardId: "board-101",
                changes: {
                    title: "Updated Board Title",
                    isArchived: true
                }
            }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_upd"],
                event: boardUpdatedEvent
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const tab1Msgs = tab1.getSentMessages().map(m => JSON.parse(m));
        const tab2Msgs = tab2.getSentMessages().map(m => JSON.parse(m));

        expect(tab1Msgs.some(m => m.type === "user:org_board_updated" && m.payload.changes.isArchived === true)).toBe(true);
        expect(tab2Msgs.some(m => m.type === "user:org_board_updated" && m.payload.changes.isArchived === true)).toBe(true);
    });
});
