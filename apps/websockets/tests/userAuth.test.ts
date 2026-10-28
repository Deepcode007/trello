import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import
{
    handleWebSocketClose,
    handleWebSocketMessage,
    handleUpgradeRequest,
    userSocketRegistry
} from "../src/server";
import { type WebSocketData } from "../src/types/events";
import { env } from "../src/env";

const JWT_SECRET = env.INTERNAL_BROADCAST_SECRET || env.jwt_key || "test-jwt-secret";

describe("Phase 3: WebSocket Extension — User Authorization & Security", () =>
{
    function createMockSocket(userId?: string, email = "user@test.com", name = "Test User")
    {
        const subscriptions = new Set<string>();
        const sentMessages: string[] = [];
        const subscribedTopics: string[] = [];
        const unsubscribedTopics: string[] = [];

        const ws = {
            data: {
                userId: userId as string,
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
    });

    afterEach(() =>
    {
        userSocketRegistry.clear();
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 7: subscribe_user rejects unauthenticated socket
    // -------------------------------------------------------------
    it("7. subscribe_user rejects if socket session is unauthenticated (missing userId or subscriptions)", async () =>
    {
        const server = createMockServer();

        // Socket completely lacking data / subscriptions
        const bareSocket = {
            data: {} as any,
            send: mock((_msg: string) => 1),
            subscribe: mock((_topic: string) => true)
        };

        await handleWebSocketMessage(bareSocket as any, server, JSON.stringify({ action: "subscribe_user" }));
        expect(bareSocket.send).toHaveBeenCalled();
        const sent1 = JSON.parse(String((bareSocket.send.mock.calls as any)[0][0]));
        expect(sent1.error).toContain("Unauthenticated socket session");
        expect(bareSocket.subscribe).not.toHaveBeenCalled();

        // Socket with empty userId
        const emptyUserSocket = createMockSocket("");
        await handleWebSocketMessage(emptyUserSocket as any, server, JSON.stringify({ action: "subscribe_user" }));
        const sent2 = emptyUserSocket.getSentMessages().map(m => JSON.parse(m));
        expect(sent2.some(m => m.error?.includes("Unauthenticated socket session"))).toBe(true);
        expect(emptyUserSocket.subscribe).not.toHaveBeenCalled();

        // Socket with undefined userId
        const undefinedUserSocket = createMockSocket(undefined);
        await handleWebSocketMessage(undefinedUserSocket as any, server, JSON.stringify({ action: "subscribe_user" }));
        const sent3 = undefinedUserSocket.getSentMessages().map(m => JSON.parse(m));
        expect(sent3.some(m => m.error?.includes("Unauthenticated socket session"))).toBe(true);
        expect(undefinedUserSocket.subscribe).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 8: Socket cannot subscribe to another user's topic
    // -------------------------------------------------------------
    it("8. A socket cannot subscribe to another user's topic (cross-user spoofing rejected)", async () =>
    {
        const server = createMockServer();
        // Client is authenticated as user_alice
        const ws = createMockSocket("user_alice", "alice@test.com", "Alice");

        // Malicious client attempts to subscribe to user_bob
        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "subscribe_user",
            userId: "user_bob"
        }));

        // Rejected with Forbidden
        const sent = ws.getSentMessages().map(m => JSON.parse(m));
        expect(sent.some(m => m.error?.includes("Forbidden: cannot subscribe to another user's topic"))).toBe(true);

        // Subscriptions do NOT contain user_bob
        expect(ws.data.subscriptions.has("user_user_bob")).toBe(false);
        expect(ws.subscribe).not.toHaveBeenCalledWith("user_user_bob");

        // Attempting to join user topic through board join action is prepended with board_
        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "user_bob"
        }));
        // Topic becomes board_user_bob, never user_bob
        expect(ws.data.subscriptions.has("user_user_bob")).toBe(false);
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 9: POST /internal/notify-users rejects invalid/missing internal secret
    // -------------------------------------------------------------
    it("9. POST /internal/notify-users rejects invalid or missing internal secret with 403", async () =>
    {
        const server = createMockServer();

        // Missing secret header
        const missingSecretReq = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                userIds: ["user_1"],
                event: { type: "user:notification", payload: {} }
            })
        });

        const res1 = await handleUpgradeRequest(missingSecretReq, server as any, JWT_SECRET);
        expect(res1?.status).toBe(403);
        const json1 = await res1?.json() as { error: string };
        expect(json1.error).toContain("Forbidden");

        // Invalid secret header
        const badSecretReq = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": "wrong-invalid-secret"
            },
            body: JSON.stringify({
                userIds: ["user_1"],
                event: { type: "user:notification", payload: {} }
            })
        });

        const res2 = await handleUpgradeRequest(badSecretReq, server as any, JWT_SECRET);
        expect(res2?.status).toBe(403);
        const json2 = await res2?.json() as { error: string };
        expect(json2.error).toContain("Forbidden");
    });

    // -------------------------------------------------------------
    // Blueprint Scenario 10: Reconnected socket can subscribe to user topic again
    // -------------------------------------------------------------
    it("10. Reconnected socket can subscribe to its user topic again", async () =>
    {
        const server = createMockServer();

        // 1. First connection
        const sock1 = createMockSocket("user_reconnect", "recon@test.com", "Recon");
        await handleWebSocketMessage(sock1, server, JSON.stringify({ action: "subscribe_user" }));
        expect(sock1.data.subscriptions.has("user_user_reconnect")).toBe(true);

        // 2. Disconnection
        handleWebSocketClose(sock1, server, 1000, "Client closed");
        expect(userSocketRegistry.get("user_reconnect")).toBeUndefined();

        // 3. New socket connection for the same user
        const sock2 = createMockSocket("user_reconnect", "recon@test.com", "Recon");
        await handleWebSocketMessage(sock2, server, JSON.stringify({ action: "subscribe_user" }));

        expect(sock2.data.subscriptions.has("user_user_reconnect")).toBe(true);
        expect(userSocketRegistry.get("user_reconnect")?.has(sock2 as any)).toBe(true);

        // 4. Notification delivered to new socket
        const event = {
            type: "user:notification",
            payload: { notification: { id: "notif-after-reconnect" } }
        };

        const req = new Request("http://localhost:3001/internal/notify-users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET
            },
            body: JSON.stringify({
                userIds: ["user_reconnect"],
                event
            })
        });

        const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
        expect(res?.status).toBe(200);

        const msgs = sock2.getSentMessages().map(m => JSON.parse(m));
        expect(msgs.some(m => m.payload?.notification?.id === "notif-after-reconnect")).toBe(true);
    });

    // -------------------------------------------------------------
    // Request Validation for POST /internal/notify-users
    // -------------------------------------------------------------
    describe("POST /internal/notify-users Request Validation", () =>
    {
        it("rejects non-object JSON body with 400", async () =>
        {
            const server = createMockServer();
            for (const badBody of ["null", "123", '"text"', "[1, 2]"])
            {
                const req = new Request("http://localhost:3001/internal/notify-users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-internal-secret": JWT_SECRET },
                    body: badBody
                });
                const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
                expect(res?.status).toBe(400);
            }
        });

        it("rejects missing, empty, or non-array userIds with 400", async () =>
        {
            const server = createMockServer();
            const badUserIdsCases = [
                {}, // missing userIds
                { userIds: [] }, // empty array
                { userIds: "user_1" }, // string instead of array
                { userIds: 123 }, // number
                { userIds: null } // null
            ];

            for (const payload of badUserIdsCases)
            {
                const req = new Request("http://localhost:3001/internal/notify-users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-internal-secret": JWT_SECRET },
                    body: JSON.stringify({
                        ...payload,
                        event: { type: "user:notification", payload: {} }
                    })
                });
                const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
                expect(res?.status).toBe(400);
            }
        });

        it("rejects userIds containing empty, whitespace, or non-string elements with 400", async () =>
        {
            const server = createMockServer();
            const invalidEntries = [
                [""],
                ["   "],
                ["valid_user", ""],
                [12345],
                [null],
                [undefined]
            ];

            for (const userIds of invalidEntries)
            {
                const req = new Request("http://localhost:3001/internal/notify-users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-internal-secret": JWT_SECRET },
                    body: JSON.stringify({
                        userIds,
                        event: { type: "user:notification", payload: {} }
                    })
                });
                const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
                expect(res?.status).toBe(400);
            }
        });

        it("rejects missing, empty, or invalid event fields with 400", async () =>
        {
            const server = createMockServer();
            const badEventCases = [
                { userIds: ["u1"] }, // missing event
                { userIds: ["u1"], event: "not-an-object" }, // non-object event
                { userIds: ["u1"], event: { payload: {} } }, // missing event.type
                { userIds: ["u1"], event: { type: "", payload: {} } }, // empty event.type
                { userIds: ["u1"], event: { type: "   ", payload: {} } }, // whitespace event.type
                { userIds: ["u1"], event: { type: "user:notification" } } // missing event.payload
            ];

            for (const payload of badEventCases)
            {
                const req = new Request("http://localhost:3001/internal/notify-users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-internal-secret": JWT_SECRET },
                    body: JSON.stringify(payload)
                });
                const res = await handleUpgradeRequest(req, server as any, JWT_SECRET);
                expect(res?.status).toBe(400);
            }
        });
    });

    // -------------------------------------------------------------
    // Repeated subscribe_user handling
    // -------------------------------------------------------------
    it("handles repeated subscribe_user gracefully with alreadySubscribed flag", async () =>
    {
        const ws = createMockSocket("user_repeat", "repeat@test.com", "Repeat");
        const server = createMockServer();

        // First subscription
        await handleWebSocketMessage(ws, server, JSON.stringify({ action: "subscribe_user" }));
        expect(ws.subscribe).toHaveBeenCalledTimes(1);

        // Second subscription
        await handleWebSocketMessage(ws, server, JSON.stringify({ action: "subscribe_user" }));
        expect(ws.subscribe).toHaveBeenCalledTimes(1); // Not called again

        const messages = ws.getSentMessages().map(m => JSON.parse(m));
        expect(messages.length).toBe(2);
        expect(messages[1].alreadySubscribed).toBe(true);
    });
});
