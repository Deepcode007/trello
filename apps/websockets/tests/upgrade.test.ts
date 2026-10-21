import { describe, expect, it, mock } from "bun:test";
import jwt from "jsonwebtoken";
import { handleUpgradeRequest, createWebSocketServer, userSocketRegistry, evictUserSockets } from "../src/server";
import type { WebSocketData } from "../src/types/events";
import { env } from "../src/env";

const JWT_SECRET = env.INTERNAL_BROADCAST_SECRET as jwt.Secret;

describe("WebSocket Upgrade Handshake & HTTP Layer Tests", () => {
    function getTestPort(): number
    {
        return 20_000 + Math.floor(Math.random() * 40_000);
    }
    const userId = "user-abc-123";
    const email = "user@test.com";
    const validToken = jwt.sign({ id: userId, email }, JWT_SECRET);

    function createMockServer() {
        let upgradeCalledWith: { req: Request; options?: { data: WebSocketData; headers?: any } } | null = null;
        let publishedMessages: { topic: string; message: string }[] = [];
        let shouldUpgradeSucceed = true;

        const server = {
            port: 3001,
            upgrade: mock((req: Request, options: { data: WebSocketData; headers?: any }) => {
                upgradeCalledWith = { req, options };
                return shouldUpgradeSucceed;
            }),
            publish: mock((topic: string, message: string) => {
                publishedMessages.push({ topic, message });
                return 1;
            }),
            setUpgradeSuccess(val: boolean) {
                shouldUpgradeSucceed = val;
            },
            getUpgradeCalledWith() {
                return upgradeCalledWith;
            },
            getPublishedMessages() {
                return publishedMessages;
            }
        };

        return server;
    }

    it("rejects unauthenticated requests at the HTTP handshake level with 401", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/ws", {
            headers: {
                "upgrade": "websocket",
                "connection": "Upgrade"
            }
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(401);
        const text = await res?.text();
        expect(text).toBe("Unauthorized");
        expect(mockServer.upgrade).not.toHaveBeenCalled();
    });

    it("rejects invalid token at upgrade with 401", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/ws", {
            headers: {
                "authorization": "Bearer bad-token",
                "upgrade": "websocket"
            }
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(401);
        expect(mockServer.upgrade).not.toHaveBeenCalled();
    });

    it("calls server.upgrade with user data when token is valid and returns undefined on success", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/ws", {
            headers: {
                "authorization": `Bearer ${validToken}`,
                "upgrade": "websocket",
                "connection": "Upgrade"
            }
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeUndefined(); // Handed off to WebSocket protocol
        expect(mockServer.upgrade).toHaveBeenCalledTimes(1);

        const call = mockServer.getUpgradeCalledWith();
        expect(call).not.toBeNull();
        expect(call?.options?.data?.userId).toBe(userId);
        expect(call?.options?.data?.email).toBe(email);
        expect(call?.options?.data?.subscriptions).toBeInstanceOf(Set);
        expect(typeof call?.options?.data?.connectedAt).toBe("number");
    });

    it("returns 426 WebSocket Only if server.upgrade returns false (non-websocket request)", async () => {
        const mockServer = createMockServer();
        mockServer.setUpgradeSuccess(false);

        const req = new Request("http://localhost:3001/", {
            headers: {
                "authorization": `Bearer ${validToken}`
            }
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(426);
        expect(res?.headers.get("upgrade")).toBe("websocket");
    });

    it("handles GET /health with 200 OK and status JSON", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/health");

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(200);
        const data = await res?.json() as { status: string; service: string; port: number };
        expect(data.status).toBe("ok");
        expect(data.service).toBe("websockets");
        expect(data.port).toBe(3001);
    });

    it("handles POST /internal/broadcast and publishes to board room when valid secret is provided", async () => {
        const mockServer = createMockServer();
        const event = { type: "card:moved", payload: { cardId: "card_1", sourceList: "list_1", destList: "list_2", position: 1 } };
        const req = new Request("http://localhost:3001/internal/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET as string
            },
            body: JSON.stringify({
                boardId: "board_123",
                event
            })
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(200);
        const json = await res?.json() as { success: boolean };
        expect(json.success).toBe(true);

        const messages = mockServer.getPublishedMessages();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0]?.topic).toBe("board_123");
        expect(messages[0]?.message).toContain("card:moved");
    });

    it("rejects POST /internal/broadcast with 403 when x-internal-secret header is missing and secret is configured", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/internal/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                boardId: "board_123",
                event: { type: "card:moved", payload: {} }
            })
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(403);
        const json = await res?.json() as { error: string };
        expect(json.error).toContain("Forbidden");
    });

    it("returns 400 for POST /internal/broadcast with missing fields", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/internal/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET as string
            },
            body: JSON.stringify({ boardId: "board_123" }) // missing event
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(400);
    });

    it("returns 400 for POST /internal/broadcast with non-string boardId", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/internal/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": JWT_SECRET as string
            },
            body: JSON.stringify({ boardId: 12345, event: { type: "card:moved" } })
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(400);
    });

    it("returns 400 for POST /internal/broadcast with empty or whitespace boardId", async () => {
        for (const badBoardId of ["", "   "]) {
            const mockServer = createMockServer();
            const req = new Request("http://localhost:3001/internal/broadcast", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET as string
                },
                body: JSON.stringify({ boardId: badBoardId, event: { type: "card:moved" } })
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res).toBeDefined();
            expect(res?.status).toBe(400);
        }
    });

    it("returns 400 for POST /internal/broadcast with non-object JSON body", async () => {
        for (const badBody of ["null", "123", '"string"', "[1, 2]"]) {
            const mockServer = createMockServer();
            const req = new Request("http://localhost:3001/internal/broadcast", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET as string
                },
                body: badBody
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res).toBeDefined();
            expect(res?.status).toBe(400);
        }
    });

    it.skip("allows POST /internal/broadcast without secret header when jwtSecret is not configured", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/internal/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                boardId: "board_123",
                event: { type: "card:moved", payload: {} }
            })
        });

        const res = await handleUpgradeRequest(req, mockServer, "");
        expect(res).toBeDefined();
        expect(res?.status).toBe(200);
    });

    it("rejects POST /internal/broadcast with 403 when x-internal-secret is invalid", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/internal/broadcast", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-secret": "wrong-secret"
            },
            body: JSON.stringify({
                boardId: "board_123",
                event: { type: "card:moved", payload: {} }
            })
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeDefined();
        expect(res?.status).toBe(403);
    });

    it("echoes Sec-WebSocket-Protocol in upgrade headers when provided", async () => {
        const mockServer = createMockServer();
        const req = new Request("http://localhost:3001/ws", {
            headers: {
                "authorization": `Bearer ${validToken}`,
                "upgrade": "websocket",
                "connection": "Upgrade",
                "sec-websocket-protocol": "bearer, other-proto"
            }
        });

        const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
        expect(res).toBeUndefined(); // Handed off to WebSocket protocol
        expect(mockServer.upgrade).toHaveBeenCalledTimes(1);

        const call = mockServer.getUpgradeCalledWith();
        expect(call).not.toBeNull();
        expect(call?.options?.headers).toBeDefined();
        expect(call?.options?.headers?.["Sec-WebSocket-Protocol"]).toBe("bearer");
    });

    it.skip("createWebSocketServer throws when no secret is provided in options or environment", () => {
        const origEnvKey = process.env.jwt_key;
        const origEnvSecret = process.env.JWT_SECRET;
        delete process.env.jwt_key;
        delete process.env.JWT_SECRET;

        try {
            expect(() => createWebSocketServer({ port: 3099 })).toThrow("JWT secret must be configured");
        } finally {
            if (origEnvKey !== undefined) process.env.jwt_key = origEnvKey;
            if (origEnvSecret !== undefined) process.env.JWT_SECRET = origEnvSecret;
        }
    });

    it("createWebSocketServer initializes when options.jwtSecret is provided", () => {
        const s = createWebSocketServer({ port: getTestPort(), jwtSecret: "custom-test-secret" });
        expect(s).toBeDefined();
        expect(s.port).toBeGreaterThan(0);
        s.stop(true);
    });

    describe("POST /internal/evict-user Tests", () => {
        it("rejects /internal/evict-user with 403 on invalid secret", async () => {
            const mockServer = createMockServer();
            const req = new Request("http://localhost:3001/internal/evict-user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": "wrong-secret"
                },
                body: JSON.stringify({ userId: "u1" })
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res?.status).toBe(403);
        });

        it("rejects /internal/evict-user with 400 on missing or invalid userId", async () => {
            const mockServer = createMockServer();
            const req = new Request("http://localhost:3001/internal/evict-user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET as string
                },
                body: JSON.stringify({})
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res?.status).toBe(400);
        });

        it("evicts user from specific org boards without closing sockets subscribed to other boards", async () => {
            const mockServer = createMockServer();
            const testUserId = "user-multi-org-1";

            let ws1Closed = false;
            let ws1Sent: any[] = [];
            const mockWs1: any = {
                data: {
                    userId: testUserId,
                    subscriptions: new Set(["board_org1_b1", "board_org2_b1"])
                },
                send: mock((msg: string) => { ws1Sent.push(JSON.parse(msg)); }),
                unsubscribe: mock((topic: string) => {}),
                close: mock(() => { ws1Closed = true; })
            };

            let ws2Closed = false;
            let ws2CloseCode = 0;
            let ws2Sent: any[] = [];
            const mockWs2: any = {
                data: {
                    userId: testUserId,
                    subscriptions: new Set(["board_org1_b2"])
                },
                send: mock((msg: string) => { ws2Sent.push(JSON.parse(msg)); }),
                unsubscribe: mock((topic: string) => {}),
                close: mock((code: number) => { ws2Closed = true; ws2CloseCode = code; })
            };

            userSocketRegistry.set(testUserId, new Set([mockWs1, mockWs2]));

            const req = new Request("http://localhost:3001/internal/evict-user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET as string
                },
                body: JSON.stringify({
                    userId: testUserId,
                    orgId: "org1",
                    boardIds: ["org1_b1", "org1_b2"]
                })
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res?.status).toBe(200);
            const data = (await res?.json()) as any;
            expect(data.success).toBe(true);

            // ws1 still has board_org2_b1 subscription and must NOT be closed
            expect(ws1Closed).toBe(false);
            expect(mockWs1.data.subscriptions.has("board_org1_b1")).toBe(false);
            expect(mockWs1.data.subscriptions.has("board_org2_b1")).toBe(true);
            expect(ws1Sent.some((m: any) => m.type === "board:evicted" && m.boardId === "org1_b1")).toBe(true);

            // ws2 only had board_org1_b2, so its subscriptions are now empty and it must be closed with 4003
            expect(ws2Closed).toBe(true);
            expect(ws2CloseCode).toBe(4003);
            expect(mockWs2.data.subscriptions.size).toBe(0);

            // userSocketRegistry should still contain ws1
            const remaining = userSocketRegistry.get(testUserId);
            expect(remaining?.has(mockWs1)).toBe(true);
            expect(remaining?.has(mockWs2)).toBe(false);

            userSocketRegistry.delete(testUserId);
        });

        it("closes all sockets on global user eviction without orgId", async () => {
            const mockServer = createMockServer();
            const testUserId = "user-global-evict-1";

            let wsClosed = false;
            let wsCloseCode = 0;
            const mockWs: any = {
                data: {
                    userId: testUserId,
                    subscriptions: new Set(["board_org1_b1", "board_org2_b1"])
                },
                send: mock(() => {}),
                unsubscribe: mock(() => {}),
                close: mock((code: number) => { wsClosed = true; wsCloseCode = code; })
            };

            userSocketRegistry.set(testUserId, new Set([mockWs]));

            const req = new Request("http://localhost:3001/internal/evict-user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET as string
                },
                body: JSON.stringify({ userId: testUserId })
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res?.status).toBe(200);
            expect(wsClosed).toBe(true);
            expect(wsCloseCode).toBe(4003);
            expect(mockWs.data.subscriptions.size).toBe(0);
            expect(userSocketRegistry.has(testUserId)).toBe(false);
        });

        it("evictUserSockets handles direct in-memory invocation with zero latency", async () => {
            const mockServer = createMockServer();
            const directUserId = "user-direct-evict";

            let wsClosed = false;
            let wsCloseCode = 0;
            const mockWs: any = {
                data: {
                    userId: directUserId,
                    subscriptions: new Set(["board_orgDirect_1"])
                },
                send: mock(() => {}),
                unsubscribe: mock(() => {}),
                close: mock((code: number) => { wsClosed = true; wsCloseCode = code; })
            };

            userSocketRegistry.set(directUserId, new Set([mockWs]));

            const count = await evictUserSockets(mockServer as any, {
                userId: directUserId,
                boardIds: ["orgDirect_1"]
            });

            expect(count).toBe(1);
            expect(wsClosed).toBe(true);
            expect(wsCloseCode).toBe(4003);
            expect(userSocketRegistry.has(directUserId)).toBe(false);
        });

        it("evictUserSockets returns 0 safely for unknown userId or invalid input", async () => {
            const mockServer = createMockServer();
            expect(await evictUserSockets(mockServer as any, { userId: "" })).toBe(0);
            expect(await evictUserSockets(mockServer as any, {} as any)).toBe(0);
            expect(await evictUserSockets(mockServer as any, { userId: "non-existent-user" })).toBe(0);
        });

        it("evictUserSockets safely handles sockets with missing or undefined subscriptions without throwing", async () => {
            const mockServer = createMockServer();
            const malformedUserId = "user-malformed-ws";

            const mockMalformedWs1: any = { data: undefined };
            const mockMalformedWs2: any = { data: { userId: malformedUserId, subscriptions: undefined } };

            userSocketRegistry.set(malformedUserId, new Set([mockMalformedWs1, mockMalformedWs2]));

            // Test scoped eviction
            const countScoped = await evictUserSockets(mockServer as any, {
                userId: malformedUserId,
                orgId: "org-test"
            });
            expect(countScoped).toBe(0);

            // Test global eviction
            const countGlobal = await evictUserSockets(mockServer as any, {
                userId: malformedUserId
            });
            expect(countGlobal).toBe(2);

            userSocketRegistry.delete(malformedUserId);
        });
    });
});
