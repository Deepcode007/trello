import { describe, expect, it, mock } from "bun:test";
import jwt from "backend/src/helpers/jwt";
import { handleUpgradeRequest, createWebSocketServer } from "../src/server";
import type { WebSocketData } from "../src/types/events";

const JWT_SECRET = "upgrade-test-jwt-secret";

describe("WebSocket Upgrade Handshake & HTTP Layer Tests", () => {
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
                "x-internal-secret": JWT_SECRET
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
                "x-internal-secret": JWT_SECRET
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
                "x-internal-secret": JWT_SECRET
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
                    "x-internal-secret": JWT_SECRET
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
                    "x-internal-secret": JWT_SECRET
                },
                body: badBody
            });

            const res = await handleUpgradeRequest(req, mockServer, JWT_SECRET);
            expect(res).toBeDefined();
            expect(res?.status).toBe(400);
        }
    });

    it("allows POST /internal/broadcast without secret header when jwtSecret is not configured", async () => {
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

    it("createWebSocketServer throws when no secret is provided in options or environment", () => {
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
        const s = createWebSocketServer({ port: 3098, jwtSecret: "custom-test-secret" });
        expect(s).toBeDefined();
        expect(s.port).toBe(3098);
        s.stop(true);
    });
});
