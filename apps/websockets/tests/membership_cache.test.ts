import { beforeEach, describe, expect, it, mock } from "bun:test";
import
{
    userOrgMembership,
    orgMembers,
    boardOrgMap,
    recordUserMembership,
    revokeUserMembership,
    cleanupUserMembership,
    resetMembershipRegistries,
    userSocketRegistry,
    evictUserSockets,
    handleWebSocketMessage,
    handleWebSocketClose,
    setBoardAccessChecker,
    resetBoardAccessChecker
} from "../src/server";
import { type WebSocketData, formatBoardTopic } from "../src/types/events";
import type { ServerWebSocket } from "bun";

describe("In-Memory Membership Registry & Fast-Path Eviction Tests", () =>
{
    beforeEach(() =>
    {
        resetMembershipRegistries();
        userSocketRegistry.clear();
        resetBoardAccessChecker();
    });

    function createMockSocket(userId: string, email = "test@example.com")
    {
        const subscriptions = new Set<string>();
        const sentMessages: string[] = [];
        const closedDetails: { code?: number; reason?: string }[] = [];

        const ws = {
            data: {
                userId,
                email,
                name: "Test User",
                subscriptions,
                connectedAt: Date.now()
            } as WebSocketData,
            subscribe: mock((topic: string) =>
            {
                subscriptions.add(topic);
                return true;
            }),
            unsubscribe: mock((topic: string) =>
            {
                subscriptions.delete(topic);
                return true;
            }),
            send: mock((msg: string) =>
            {
                sentMessages.push(msg);
                return 1;
            }),
            close: mock((code?: number, reason?: string) =>
            {
                closedDetails.push({ code, reason });
            }),
            getSentMessages()
            {
                return sentMessages;
            },
            getClosedDetails()
            {
                return closedDetails;
            }
        };

        let set = userSocketRegistry.get(userId);
        if (!set)
        {
            set = new Set();
            userSocketRegistry.set(userId, set);
        }
        set.add(ws as unknown as ServerWebSocket<WebSocketData>);

        return ws;
    }

    function createMockServer()
    {
        const published: { topic: string; message: string }[] = [];
        return {
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

    describe("Registry Lifecycle Helpers", () =>
    {
        it("records user membership and maps board to org", () =>
        {
            recordUserMembership("user_1", "org_1", "board_100");

            expect(userOrgMembership.get("user_1")?.has("org_1")).toBe(true);
            expect(orgMembers.get("org_1")?.has("user_1")).toBe(true);
            expect(boardOrgMap.get("100")).toBe("org_1");
        });

        it("normalizes board IDs using cleanBoardId", () =>
        {
            recordUserMembership("user_1", "org_1", "board_abc-123");
            expect(boardOrgMap.get("abc-123")).toBe("org_1");

            recordUserMembership("user_1", "org_1", "xyz-789");
            expect(boardOrgMap.get("xyz-789")).toBe("org_1");
        });

        it("revokes user membership and prunes empty sets", () =>
        {
            recordUserMembership("user_1", "org_1");
            recordUserMembership("user_1", "org_2");

            revokeUserMembership("user_1", "org_1");

            expect(userOrgMembership.get("user_1")?.has("org_1")).toBe(false);
            expect(userOrgMembership.get("user_1")?.has("org_2")).toBe(true);
            expect(orgMembers.get("org_1")).toBeUndefined();
            expect(orgMembers.get("org_2")?.has("user_1")).toBe(true);

            revokeUserMembership("user_1", "org_2");
            expect(userOrgMembership.get("user_1")).toBeUndefined();
            expect(orgMembers.get("org_2")).toBeUndefined();
        });

        it("cleanupUserMembership purges all org associations for a user", () =>
        {
            recordUserMembership("user_1", "org_1");
            recordUserMembership("user_1", "org_2");
            recordUserMembership("user_2", "org_1");

            cleanupUserMembership("user_1");

            expect(userOrgMembership.get("user_1")).toBeUndefined();
            expect(orgMembers.get("org_1")?.has("user_1")).toBe(false);
            expect(orgMembers.get("org_1")?.has("user_2")).toBe(true);
            expect(orgMembers.get("org_2")).toBeUndefined();
        });

        it("resetMembershipRegistries clears all maps", () =>
        {
            recordUserMembership("user_1", "org_1", "board_1");
            resetMembershipRegistries();

            expect(userOrgMembership.size).toBe(0);
            expect(orgMembers.size).toBe(0);
            expect(boardOrgMap.size).toBe(0);
        });
    });

    describe("Fast-Path vs Cold-Path Access Verification on Join", () =>
    {
        it("uses fast-path (bypasses checkAccess) when user and board are cached", async () =>
        {
            const mockServer = createMockServer();
            const ws = createMockSocket("user_alice");

            // Pre-seed cache: user_alice belongs to org_corp, and board_b1 belongs to org_corp
            recordUserMembership("user_alice", "org_corp", "board_b1");

            // Access checker that would fail if called
            const mockChecker = mock(() => false);
            setBoardAccessChecker(mockChecker);

            await handleWebSocketMessage(
                ws as unknown as ServerWebSocket<WebSocketData>,
                mockServer,
                JSON.stringify({ action: "join", boardId: "board_b1" })
            );

            // Access checker should NOT be called because fast-path succeeded
            expect(mockChecker).not.toHaveBeenCalled();

            const sent = ws.getSentMessages().map(m => JSON.parse(m));
            expect(sent).toContainEqual(expect.objectContaining({ type: "joined", boardId: "board_b1" }));
            expect(ws.data.subscriptions.has("board_b1")).toBe(true);
        });

        it("falls back to cold-path checker when not in cache", async () =>
        {
            const mockServer = createMockServer();
            const ws = createMockSocket("user_bob");

            // Board org is known, but bob's membership is not cached yet
            boardOrgMap.set("b2", "org_marketing");

            const mockChecker = mock(() => true);
            setBoardAccessChecker(mockChecker);

            await handleWebSocketMessage(
                ws as unknown as ServerWebSocket<WebSocketData>,
                mockServer,
                JSON.stringify({ action: "join", boardId: "b2" })
            );

            expect(mockChecker).toHaveBeenCalled();
            expect(userOrgMembership.get("user_bob")?.has("org_marketing")).toBe(true);
            expect(ws.data.subscriptions.has("board_b2")).toBe(true);
        });

        it("denies access if cold-path checker returns false", async () =>
        {
            const mockServer = createMockServer();
            const ws = createMockSocket("user_intruder");

            const mockChecker = mock(() => false);
            setBoardAccessChecker(mockChecker);

            await handleWebSocketMessage(
                ws as unknown as ServerWebSocket<WebSocketData>,
                mockServer,
                JSON.stringify({ action: "join", boardId: "b3" })
            );

            expect(mockChecker).toHaveBeenCalled();
            const sent = ws.getSentMessages().map(m => JSON.parse(m));
            expect(sent).toContainEqual(expect.objectContaining({
                error: "Access denied: not a member of this board's organization"
            }));
            expect(ws.data.subscriptions.size).toBe(0);
        });
    });

    describe("In-Memory Socket Eviction & Isolation", () =>
    {
        it("evicts user from org boards using boardOrgMap without DB queries", async () =>
        {
            const mockServer = createMockServer();
            const ws = createMockSocket("user_alice");

            // Alice joins board_1 (Org A)
            recordUserMembership("user_alice", "org_a", "board_1");
            ws.data.subscriptions.add(formatBoardTopic("board_1")!);

            const evictedCount = await evictUserSockets(mockServer, {
                userId: "user_alice",
                orgId: "org_a"
            });

            expect(evictedCount).toBe(1);
            expect(ws.data.subscriptions.has(formatBoardTopic("board_1")!)).toBe(false);
            expect(userOrgMembership.get("user_alice")?.has("org_a")).toBeFalsy();

            const sent = ws.getSentMessages().map(m => JSON.parse(m));
            expect(sent).toContainEqual(expect.objectContaining({
                type: "board:evicted",
                boardId: "1"
            }));
            expect(ws.getClosedDetails()).toContainEqual(expect.objectContaining({
                code: 4003
            }));
        });

        it("selective multi-org eviction keeps socket open for other org boards", async () =>
        {
            const mockServer = createMockServer();
            const ws = createMockSocket("user_alice");

            // Alice belongs to Org A (board_1) and Org B (board_2)
            recordUserMembership("user_alice", "org_a", "board_1");
            recordUserMembership("user_alice", "org_b", "board_2");
            ws.data.subscriptions.add(formatBoardTopic("board_1")!);
            ws.data.subscriptions.add(formatBoardTopic("board_2")!);

            // Evict Alice from Org A only
            const evictedCount = await evictUserSockets(mockServer, {
                userId: "user_alice",
                orgId: "org_a"
            });

            expect(evictedCount).toBe(1);
            // board_1 unsubscribed
            expect(ws.data.subscriptions.has(formatBoardTopic("board_1")!)).toBe(false);
            // board_2 STILL subscribed!
            expect(ws.data.subscriptions.has(formatBoardTopic("board_2")!)).toBe(true);

            // Socket is NOT closed because board_2 is still active
            expect(ws.getClosedDetails().length).toBe(0);

            // Alice's membership in org_a revoked, org_b remains
            expect(userOrgMembership.get("user_alice")?.has("org_a")).toBeFalsy();
            expect(userOrgMembership.get("user_alice")?.has("org_b")).toBe(true);
        });

        it("global user eviction terminates all sockets and cleans up membership", async () =>
        {
            const mockServer = createMockServer();
            const ws = createMockSocket("user_alice");

            recordUserMembership("user_alice", "org_a", "board_1");
            recordUserMembership("user_alice", "org_b", "board_2");
            ws.data.subscriptions.add("board_1");
            ws.data.subscriptions.add("board_2");

            const evictedCount = await evictUserSockets(mockServer, {
                userId: "user_alice"
            });

            expect(evictedCount).toBe(1);
            expect(ws.data.subscriptions.size).toBe(0);
            expect(ws.getClosedDetails()).toContainEqual(expect.objectContaining({
                code: 4003
            }));
            expect(userOrgMembership.get("user_alice")).toBeUndefined();
            expect(userSocketRegistry.get("user_alice")).toBeUndefined();
        });
    });

    describe("Disconnect Cleanup", () =>
    {
        it("cleans up user membership when last socket disconnects", () =>
        {
            const mockServer = createMockServer();
            const ws1 = createMockSocket("user_dan");

            recordUserMembership("user_dan", "org_x", "board_x");
            expect(userOrgMembership.get("user_dan")?.has("org_x")).toBe(true);
            expect(orgMembers.get("org_x")?.has("user_dan")).toBe(true);

            // Dan closes his socket
            handleWebSocketClose(
                ws1 as unknown as ServerWebSocket<WebSocketData>,
                mockServer,
                1000,
                "Normal closure"
            );

            expect(userSocketRegistry.get("user_dan")).toBeUndefined();
            expect(userOrgMembership.get("user_dan")).toBeUndefined();
            expect(orgMembers.get("org_x")?.has("user_dan")).toBeFalsy();
        });

        it("does not clean up membership if another socket for the same user is still open", () =>
        {
            const mockServer = createMockServer();
            const ws1 = createMockSocket("user_dan");
            // Add second socket for same user
            const ws2 = {
                data: {
                    userId: "user_dan",
                    subscriptions: new Set<string>()
                } as WebSocketData,
                unsubscribe: mock(() => true)
            };
            userSocketRegistry.get("user_dan")?.add(ws2 as unknown as ServerWebSocket<WebSocketData>);

            recordUserMembership("user_dan", "org_x", "board_x");

            // Close ws1 only
            handleWebSocketClose(
                ws1 as unknown as ServerWebSocket<WebSocketData>,
                mockServer,
                1000,
                "Closing tab 1"
            );

            // Dan still has ws2 connected
            expect(userSocketRegistry.get("user_dan")?.size).toBe(1);
            expect(userOrgMembership.get("user_dan")?.has("org_x")).toBe(true);
            expect(orgMembers.get("org_x")?.has("user_dan")).toBe(true);

            // Close ws2
            handleWebSocketClose(
                ws2 as unknown as ServerWebSocket<WebSocketData>,
                mockServer,
                1000,
                "Closing tab 2"
            );

            expect(userSocketRegistry.get("user_dan")).toBeUndefined();
            expect(userOrgMembership.get("user_dan")).toBeUndefined();
            expect(orgMembers.get("org_x")?.has("user_dan")).toBeFalsy();
        });
    });
});
