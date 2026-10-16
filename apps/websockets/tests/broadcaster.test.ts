import { describe, expect, it, mock } from "bun:test";
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
    });

    it("forwards a pre-recorded event identity without writing to the database", async () =>
    {
        const broadcaster = new WebSocketBroadcaster();
        const mockServer = createMockServer();
        broadcaster.setServer(mockServer as any);
        let receivedEvent: any = null;
        broadcaster.on("board:board_ws_rec_test", evt => { receivedEvent = evt; });

        await broadcaster.broadcast("board_ws_rec_test", {
            type: "card:moved",
            payload: { cardId: "c-rec", position: 1500 }
        }, { eventId: "evt-uuid-5", sequence: 6n });

        expect(receivedEvent.eventId).toBe("evt-uuid-5");
        expect(receivedEvent.sequence).toBe("6");
        expect(mockServer.getPublished()[0]?.message).toContain("evt-uuid-5");
    });
});
