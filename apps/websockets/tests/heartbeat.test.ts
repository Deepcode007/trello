import { afterEach, describe, expect, it, mock } from "bun:test";
import {
    checkHeartbeats,
    startHeartbeat,
    stopHeartbeat,
    userSocketRegistry,
    handleWebSocketMessage,
    createWebSocketServer
} from "../src/server";
import type { WebSocketData } from "../src/types/events";

describe("WebSocket Heartbeat & Zombie Socket Leaks Tests", () =>
{
    function createMockServer()
    {
        const published: { topic: string; message: string }[] = [];
        return {
            port: 3001,
            publish: mock((topic: string, message: string) =>
            {
                published.push({ topic, message });
                return 1;
            }),
            getPublished()
            {
                return published;
            }
        };
    }

    function createMockWs(userId = "user-hb-1", boardIds: string[] = ["board_alpha"])
    {
        const subscriptions = new Set<string>(boardIds);
        const sentMessages: string[] = [];
        let terminated = false;
        let closedCode: number | undefined;
        let closedReason: string | undefined;
        let pingsSent = 0;

        const ws: any = {
            data: {
                userId,
                email: `${userId}@test.com`,
                name: `Name ${userId}`,
                subscriptions,
                connectedAt: Date.now(),
                isAlive: true,
                lastPing: Date.now(),
                lastPong: Date.now()
            } as WebSocketData,
            ping: mock(() =>
            {
                pingsSent++;
                return 1;
            }),
            send: mock((msg: string) =>
            {
                sentMessages.push(msg);
                return 1;
            }),
            unsubscribe: mock((topic: string) =>
            {
                subscriptions.delete(topic);
            }),
            terminate: mock(() =>
            {
                terminated = true;
            }),
            close: mock((code?: number, reason?: string) =>
            {
                closedCode = code;
                closedReason = reason;
            }),
            getSentMessages()
            {
                return sentMessages;
            },
            isTerminated()
            {
                return terminated;
            },
            getPingsSent()
            {
                return pingsSent;
            },
            getClosedInfo()
            {
                return { code: closedCode, reason: closedReason };
            }
        };

        return ws;
    }

    afterEach(() =>
    {
        stopHeartbeat();
        userSocketRegistry.clear();
    });

    it("checkHeartbeats marks active sockets as isAlive=false and sends ws.ping()", () =>
    {
        const server = createMockServer();
        const ws = createMockWs("user-1");

        userSocketRegistry.set("user-1", new Set([ws]));
        expect(ws.data.isAlive).toBe(true);

        const result = checkHeartbeats(server);
        expect(result.deadSocketsTerminated).toBe(0);
        expect(result.pingsSent).toBe(1);
        expect(ws.ping).toHaveBeenCalledTimes(1);
        expect(ws.data.isAlive).toBe(false);
        expect(ws.isTerminated()).toBe(false);

        // Registry should still contain the socket
        expect(userSocketRegistry.get("user-1")?.has(ws)).toBe(true);
    });

    it("checkHeartbeats terminates zombie sockets that failed to respond to the previous ping", () =>
    {
        const server = createMockServer();
        const ws = createMockWs("user-zombie", ["board_100", "board_200"]);

        // Simulate socket that was marked isAlive=false during a prior heartbeat and never responded
        ws.data.isAlive = false;
        userSocketRegistry.set("user-zombie", new Set([ws]));

        const result = checkHeartbeats(server);
        expect(result.deadSocketsTerminated).toBe(1);
        expect(result.pingsSent).toBe(0);
        expect(ws.terminate).toHaveBeenCalled();

        // Socket must be evicted from userSocketRegistry
        expect(userSocketRegistry.has("user-zombie")).toBe(false);

        // Presence user:left must have been broadcast to all subscribed boards
        const published = server.getPublished();
        expect(published.length).toBe(2);

        const topics = published.map(p => p.topic);
        expect(topics).toContain("board_100");
        expect(topics).toContain("board_200");

        const event1 = JSON.parse(published.find(p => p.topic === "board_100")!.message);
        expect(event1.type).toBe("user:left");
        expect(event1.payload.userId).toBe("user-zombie");
        expect(event1.payload.boardId).toBe("100");

        // Subscriptions should be cleared
        expect(ws.data.subscriptions.size).toBe(0);
    });

    it("resets isAlive to true when client responds with JSON ping or pong before next heartbeat", () =>
    {
        const server = createMockServer();
        const ws = createMockWs("user-responsive");
        userSocketRegistry.set("user-responsive", new Set([ws]));

        // First heartbeat: marks isAlive=false
        checkHeartbeats(server);
        expect(ws.data.isAlive).toBe(false);

        // Client sends pong frame or ping frame
        handleWebSocketMessage(ws, server, JSON.stringify({ action: "pong" }));
        expect(ws.data.isAlive).toBe(true);

        // Second heartbeat: socket responded, so it should NOT be terminated
        const result2 = checkHeartbeats(server);
        expect(result2.deadSocketsTerminated).toBe(0);
        expect(result2.pingsSent).toBe(1);
        expect(ws.isTerminated()).toBe(false);
        expect(userSocketRegistry.has("user-responsive")).toBe(true);
    });

    it("handles action: pong and action: heartbeat without throwing or returning Unknown action error", async () =>
    {
        const server = createMockServer();
        const ws = createMockWs("user-actions");

        // Test action: "pong"
        await handleWebSocketMessage(ws, server, JSON.stringify({ action: "pong" }));
        expect(ws.data.isAlive).toBe(true);
        expect(ws.getSentMessages().length).toBe(0); // pong has no error response

        // Test action: "heartbeat"
        await handleWebSocketMessage(ws, server, JSON.stringify({ action: "heartbeat" }));
        expect(ws.data.isAlive).toBe(true);
        const sent = ws.getSentMessages();
        expect(sent.length).toBe(1);
        const ack = JSON.parse(sent[0]!);
        expect(ack.type).toBe("pong");
        expect(typeof ack.timestamp).toBe("number");
    });

    it("cleans up only zombie socket when user has multiple active sockets (e.g. multi-tab)", () =>
    {
        const server = createMockServer();
        const wsTab1 = createMockWs("user-multi-tab", ["board_shared"]);
        const wsTab2 = createMockWs("user-multi-tab", ["board_shared"]);

        userSocketRegistry.set("user-multi-tab", new Set([wsTab1, wsTab2]));

        // Tab 1 dies (no pong), Tab 2 remains alive
        wsTab1.data.isAlive = false;
        wsTab2.data.isAlive = true;

        const result = checkHeartbeats(server);
        expect(result.deadSocketsTerminated).toBe(1);
        expect(result.pingsSent).toBe(1);

        expect(wsTab1.terminate).toHaveBeenCalled();
        expect(wsTab2.terminate).not.toHaveBeenCalled();

        // userSocketRegistry should still hold wsTab2
        const remainingSockets = userSocketRegistry.get("user-multi-tab");
        expect(remainingSockets).toBeDefined();
        expect(remainingSockets?.has(wsTab1)).toBe(false);
        expect(remainingSockets?.has(wsTab2)).toBe(true);

        // When Tab 2 also fails its heartbeat on next cycle:
        const result2 = checkHeartbeats(server);
        expect(result2.deadSocketsTerminated).toBe(1);
        expect(userSocketRegistry.has("user-multi-tab")).toBe(false);
    });

    it("startHeartbeat schedules recurring interval and stopHeartbeat cancels it", async () =>
    {
        const server = createMockServer();
        const ws = createMockWs("user-timer");
        userSocketRegistry.set("user-timer", new Set([ws]));

        const timer = startHeartbeat(server, 20); // 20ms for fast test
        expect(timer).not.toBeNull();

        // Wait for 1 tick
        await new Promise(r => setTimeout(r, 35));
        expect(ws.data.isAlive).toBe(false);
        expect(ws.ping).toHaveBeenCalled();

        stopHeartbeat(server);

        // Reset isAlive
        ws.data.isAlive = true;
        await new Promise(r => setTimeout(r, 35));
        // Should not have been ticked again because heartbeat was stopped
        expect(ws.data.isAlive).toBe(true);
    });

    it("createWebSocketServer registers heartbeat and cancels it on server.stop()", () =>
    {
        const s = createWebSocketServer({
            port: 3097,
            jwtSecret: "test-heartbeat-secret",
            heartbeatInterval: 50
        });

        expect(s).toBeDefined();
        // server.stop() hook should clear the heartbeat timer without throwing
        expect(() => s.stop(true)).not.toThrow();
    });

    it("defensively handles sockets with missing ping/terminate methods without throwing", () =>
    {
        const server = createMockServer();
        const bareWs: any = {
            data: {
                userId: "user-bare",
                subscriptions: new Set(["board_1"]),
                connectedAt: Date.now(),
                isAlive: false
            },
            close: mock(() => {})
        };

        userSocketRegistry.set("user-bare", new Set([bareWs]));

        expect(() => checkHeartbeats(server)).not.toThrow();
        expect(bareWs.close).toHaveBeenCalled();
        expect(userSocketRegistry.has("user-bare")).toBe(false);
    });
});
