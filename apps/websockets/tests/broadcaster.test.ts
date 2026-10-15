import { describe, expect, it, mock } from "bun:test";
import { prisma } from "db/prisma";
import { WebSocketBroadcaster, wsBroadcaster } from "../src/services/broadcaster";

describe("WebSocketBroadcaster Service Integration Tests", () =>
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

    it("verifies singleton pattern across getInstance() calls", () =>
    {
        const instance1 = WebSocketBroadcaster.getInstance();
        const instance2 = WebSocketBroadcaster.getInstance();
        expect(instance1).toBe(instance2);
        expect(instance1).toBe(wsBroadcaster);
    });

    it("attaches Bun.serve instance and verifies isServerAttached", () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        expect(broadcaster.isServerAttached()).toBe(false);

        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        expect(broadcaster.isServerAttached()).toBe(true);
        expect(broadcaster.getServer()).toBe(mockServer as any);
    });

    it("publishes to server and emits events when server is attached", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        let broadcastEventReceived: any = null;
        let boardEventReceived: any = null;

        broadcaster.on("broadcast", (data) =>
        {
            broadcastEventReceived = data;
        });
        broadcaster.on("board:board_100", (data) =>
        {
            boardEventReceived = data;
        });

        const success = await broadcaster.broadcast("board_100", {
            type: "custom:event",
            payload: { message: "Hello room" }
        });

        expect(success).toBe(true);
        expect(broadcastEventReceived).not.toBeNull();
        expect(broadcastEventReceived.boardId).toBe("board_100");
        expect(boardEventReceived.type).toBe("custom:event");
        expect(boardEventReceived.payload.message).toBe("Hello room");

        const published = mockServer.getPublished();
        expect(published.length).toBeGreaterThan(0);
        expect(published[0]!.topic).toBe("board_100");
        expect(published[0]!.message).toContain("custom:event");
    });

    it("broadcastCardMoved sends standard card:moved payload shape", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        let receivedPayload: any = null;
        broadcaster.on("board:board_456", (evt) =>
        {
            receivedPayload = evt;
        });

        await broadcaster.broadcastCardMoved("board_456", {
            cardId: "card_789",
            sourceList: "section_1",
            destList: "section_2",
            position: 3
        });

        expect(receivedPayload).not.toBeNull();
        expect(receivedPayload.type).toBe("card:moved");
        expect(receivedPayload.payload.cardId).toBe("card_789");
        expect(receivedPayload.payload.sourceList).toBe("section_1");
        expect(receivedPayload.payload.destList).toBe("section_2");
        expect(receivedPayload.payload.position).toBe(3);
    });

    it("broadcastCardCreated sends standard card:created payload shape", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        let receivedPayload: any = null;
        broadcaster.on("board:board_456", (evt) =>
        {
            receivedPayload = evt;
        });

        await broadcaster.broadcastCardCreated("board_456", {
            id: "card_new",
            title: "Task title",
            sectionId: "section_1"
        });

        expect(receivedPayload.type).toBe("card:created");
        expect(receivedPayload.payload.cardData.title).toBe("Task title");
    });

    it("broadcastCardUpdated sends standard card:updated payload shape", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        let receivedPayload: any = null;
        broadcaster.on("board:board_456", (evt) =>
        {
            receivedPayload = evt;
        });

        await broadcaster.broadcastCardUpdated("board_456", "card_789", { title: "New title" });

        expect(receivedPayload.type).toBe("card:updated");
        expect(receivedPayload.payload.cardId).toBe("card_789");
        expect(receivedPayload.payload.updates.title).toBe("New title");
    });

    it("broadcastCardDeleted sends standard card:deleted payload shape", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        let receivedPayload: any = null;
        broadcaster.on("board:board_456", (evt) =>
        {
            receivedPayload = evt;
        });

        await broadcaster.broadcastCardDeleted("board_456", "card_789");

        expect(receivedPayload.type).toBe("card:deleted");
        expect(receivedPayload.payload.cardId).toBe("card_789");
    });

    it("broadcastListReordered sends standard list:reordered payload shape", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        let receivedPayload: any = null;
        broadcaster.on("board:board_456", (evt) =>
        {
            receivedPayload = evt;
        });

        await broadcaster.broadcastListReordered("board_456", "list_001", 2);

        expect(receivedPayload.type).toBe("list:reordered");
        expect(receivedPayload.payload.listId).toBe("list_001");
        expect(receivedPayload.payload.newPosition).toBe(2);
    });

    it("emits events and fails gracefully without crashing when server is not attached", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        // server is null, port points to unused port
        broadcaster.setPort(59999);

        let emitted = false;
        broadcaster.on("board:board_offline", () =>
        {
            emitted = true;
        });

        // Should not throw, returns false gracefully
        const res = await broadcaster.broadcast("board_offline", {
            type: "test",
            payload: {}
        });

        expect(emitted).toBe(true);
        expect(res).toBe(false);
    });

    it("verifies broadcaster publishes exactly once to the canonical topic without duplicate topic publishing", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        await broadcaster.broadcast("board_room_test", {
            type: "card:moved",
            payload: { cardId: "card_1", sourceList: "list_a", destList: "list_b", position: 1 }
        });

        // Exactly one publish call to the server
        const published = mockServer.getPublished();
        expect(published.length).toBe(1);
        expect(published[0]!.topic).toBe("board_room_test");

        // Broadcast with raw ID without board_ prefix also publishes exactly once to canonical topic
        await broadcaster.broadcast("uuid_999", {
            type: "card:created",
            payload: { cardData: { id: "card_2" } }
        });

        expect(mockServer.getPublished().length).toBe(2);
        expect(mockServer.getPublished()[1]!.topic).toBe("board_uuid_999");
    });

    it("handles non-string, empty, or whitespace boardIds gracefully by returning false without publishing", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);

        const invalidBoardIds = [12345, 0, false, true, null, undefined, {}, [], "", "   "];
        for (const badId of invalidBoardIds)
        {
            const res = await broadcaster.broadcast(badId as any, { type: "test", payload: {} });
            expect(res).toBe(false);
        }

        expect(mockServer.getPublished().length).toBe(0);
    });

    describe("evictUser and in-memory EvictionHandler", () =>
    {
        it("emits evictUser event on local EventEmitter with parameters", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            let emitted: any = null;
            broadcaster.on("evictUser", (data) =>
            {
                emitted = data;
            });

            // Set a dummy handler so it doesn't try fetch
            broadcaster.setEvictionHandler(() => true);

            await broadcaster.evictUser("user_abc", "org_123", ["board_1", "board_2"]);
            expect(emitted).not.toBeNull();
            expect(emitted.userId).toBe("user_abc");
            expect(emitted.orgId).toBe("org_123");
            expect(emitted.boardIds).toEqual(["board_1", "board_2"]);
        });

        it("invokes registered evictionHandler directly in-memory and returns true", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            let handlerCalledWith: any = null;

            broadcaster.setEvictionHandler(async (opts) =>
            {
                handlerCalledWith = opts;
                return 2; // evicted 2 sockets
            });

            expect(broadcaster.getEvictionHandler()).not.toBeNull();

            const res = await broadcaster.evictUser("user_xyz", "org_999", ["board_alpha"]);
            expect(res).toBe(true);
            expect(handlerCalledWith).not.toBeNull();
            expect(handlerCalledWith.userId).toBe("user_xyz");
            expect(handlerCalledWith.orgId).toBe("org_999");
            expect(handlerCalledWith.boardIds).toEqual(["board_alpha"]);
            expect(handlerCalledWith.reason).toBe("FORBIDDEN_REVOKED: Organization membership terminated");
        });

        it("returns false if registered evictionHandler throws an error", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            broadcaster.setEvictionHandler(() =>
            {
                throw new Error("Simulated eviction failure");
            });

            const res = await broadcaster.evictUser("user_err");
            expect(res).toBe(false);
        });

        it("falls back to HTTP IPC endpoint when no evictionHandler is registered", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            broadcaster.setPort(9999);

            const origFetch = globalThis.fetch;
            let fetchUrl = "";
            let fetchBody: any = null;
            let fetchHeaders: any = null;

            globalThis.fetch = mock((url: any, opts: any) =>
            {
                fetchUrl = String(url);
                fetchBody = JSON.parse(opts.body);
                fetchHeaders = opts.headers;
                return Promise.resolve(new Response(JSON.stringify({ success: true, evictedCount: 1 }), { status: 200 }));
            }) as any;

            try
            {
                const res = await broadcaster.evictUser("user_ipc", "org_ipc", ["b1"]);
                expect(res).toBe(true);
                expect(fetchUrl).toBe("http://127.0.0.1:9999/internal/evict-user");
                expect(fetchBody.userId).toBe("user_ipc");
                expect(fetchBody.orgId).toBe("org_ipc");
                expect(fetchBody.boardIds).toEqual(["b1"]);
                expect(fetchHeaders["Content-Type"]).toBe("application/json");
            } finally
            {
                globalThis.fetch = origFetch;
            }
        });

        it("returns false when HTTP fallback fails or throws", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            broadcaster.setPort(9999);

            const origFetch = globalThis.fetch;
            globalThis.fetch = mock(() => Promise.reject(new Error("Network offline"))) as any;

            try
            {
                const res = await broadcaster.evictUser("user_fail");
                expect(res).toBe(false);
            } finally
            {
                globalThis.fetch = origFetch;
            }
        });

        it("returns false immediately for empty, whitespace, or invalid userId", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            let handlerCalled = false;
            broadcaster.setEvictionHandler(() =>
            {
                handlerCalled = true;
                return true;
            });

            expect(await broadcaster.evictUser("")).toBe(false);
            expect(await broadcaster.evictUser("   ")).toBe(false);
            expect(await broadcaster.evictUser(null as any)).toBe(false);
            expect(await broadcaster.evictUser(undefined as any)).toBe(false);
            expect(await broadcaster.evictUser(12345 as any)).toBe(false);
            expect(handlerCalled).toBe(false);
        });

        it("verifies dual-server singleton consistency and evictUser availability", () =>
        {
            const instance = WebSocketBroadcaster.getInstance();
            expect(typeof instance.evictUser).toBe("function");
            expect(typeof instance.setEvictionHandler).toBe("function");
            expect(typeof instance.getEvictionHandler).toBe("function");
        });

        it("uses INTERNAL_BROADCAST_SECRET in HTTP fallback when configured", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            broadcaster.setPort(9999);

            const origSecret = process.env.INTERNAL_BROADCAST_SECRET;
            const origFetch = globalThis.fetch;
            process.env.INTERNAL_BROADCAST_SECRET = "custom-internal-secret-xyz";

            let fetchHeaders: any = null;
            globalThis.fetch = mock((_url: any, opts: any) =>
            {
                fetchHeaders = opts.headers;
                return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
            }) as any;

            try
            {
                await broadcaster.broadcast("test_board_secret", { type: "test", payload: {} });
                expect(fetchHeaders["x-internal-secret"]).toBe("custom-internal-secret-xyz");
            } finally
            {
                if (origSecret !== undefined)
                {
                    process.env.INTERNAL_BROADCAST_SECRET = origSecret;
                } else
                {
                    delete process.env.INTERNAL_BROADCAST_SECRET;
                }
                globalThis.fetch = origFetch;
            }
        });
    });

    describe("recordBoardEvent persistence and P2002 retry handling", () =>
    {
        it("returns null immediately for invalid or empty boardId", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            expect(await broadcaster.recordBoardEvent("", "card:created", {})).toBeNull();
            expect(await broadcaster.recordBoardEvent("   ", "card:created", {})).toBeNull();
            expect(await broadcaster.recordBoardEvent(null as any, "card:created", {})).toBeNull();
        });

        it("records board event with incremented sequence when findFirst succeeds", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            const origFindFirst = prisma.board_events.findFirst;
            const origCreate = prisma.board_events.create;

            prisma.board_events.findFirst = mock(() => Promise.resolve({ sequence: 7n })) as any;
            prisma.board_events.create = mock((args: any) => Promise.resolve({
                id: "evt-rec-1",
                sequence: args.data.sequence
            })) as any;

            const rec = await broadcaster.recordBoardEvent("board_123", "card:updated", { cardId: "c1" });
            expect(rec).not.toBeNull();
            expect(rec?.sequence).toBe(8n);
            expect(rec?.id).toBe("evt-rec-1");

            prisma.board_events.findFirst = origFindFirst;
            prisma.board_events.create = origCreate;
        });

        it("retries on P2002 unique constraint conflict and succeeds on next attempt", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            const origFindFirst = prisma.board_events.findFirst;
            const origCreate = prisma.board_events.create;

            let attempt = 0;
            prisma.board_events.findFirst = mock(() =>
            {
                attempt++;
                return Promise.resolve({ sequence: BigInt(attempt * 5) });
            }) as any;

            let createCalls = 0;
            prisma.board_events.create = mock((args: any) =>
            {
                createCalls++;
                if (createCalls === 1)
                {
                    const p2002Error: any = new Error("Unique constraint violation");
                    p2002Error.code = "P2002";
                    return Promise.reject(p2002Error);
                }
                return Promise.resolve({
                    id: "evt-retried-ok",
                    sequence: args.data.sequence
                });
            }) as any;

            const rec = await broadcaster.recordBoardEvent("board_123", "card:created", { cardId: "c2" });
            expect(rec).not.toBeNull();
            expect(rec?.id).toBe("evt-retried-ok");
            expect(createCalls).toBe(2);

            prisma.board_events.findFirst = origFindFirst;
            prisma.board_events.create = origCreate;
        });

        it("returns null when all 3 attempts fail with P2002", async () =>
        {
            const broadcaster = new WebSocketBroadcaster();
            const origFindFirst = prisma.board_events.findFirst;
            const origCreate = prisma.board_events.create;

            prisma.board_events.findFirst = mock(() => Promise.resolve({ sequence: 10n })) as any;
            prisma.board_events.create = mock(() =>
            {
                const p2002Error: any = new Error("Unique constraint violation");
                p2002Error.code = "P2002";
                return Promise.reject(p2002Error);
            }) as any;

            const rec = await broadcaster.recordBoardEvent("board_123", "card:created", { cardId: "c3" });
            expect(rec).toBeNull();
            expect(prisma.board_events.create).toHaveBeenCalledTimes(3);

            prisma.board_events.findFirst = origFindFirst;
            prisma.board_events.create = origCreate;
        });
    });
});
