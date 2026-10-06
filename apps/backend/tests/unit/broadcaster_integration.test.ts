import { describe, expect, it } from "bun:test";
import {
    WebSocketBroadcaster,
    wsBroadcaster,
    formatBoardTopic
} from "../../src/services/broadcaster";

describe("Backend Broadcaster Singleton and Event-Emitter Integration Tests", () => {
    it("ensures formatBoardTopic correctly prefixes or preserves board_", () => {
        expect(formatBoardTopic("board_123")).toBe("board_123");
        expect(formatBoardTopic("123")).toBe("board_123");
        expect(formatBoardTopic("abc-uuid")).toBe("board_abc-uuid");
        expect(formatBoardTopic("")).toBe("");
        expect(formatBoardTopic("   ")).toBe("");
        expect(formatBoardTopic(12345 as any)).toBe("");
        expect(formatBoardTopic(0 as any)).toBe("");
        expect(formatBoardTopic(null as any)).toBe("");
        expect(formatBoardTopic(undefined as any)).toBe("");
        expect(formatBoardTopic({} as any)).toBe("");
        expect(formatBoardTopic(true as any)).toBe("");
        expect(formatBoardTopic(false as any)).toBe("");
    });

    it("verifies singleton consistency across getInstance() calls", () => {
        const instance1 = WebSocketBroadcaster.getInstance();
        const instance2 = WebSocketBroadcaster.getInstance();
        expect(instance1).toBe(instance2);
        expect(instance1).toBe(wsBroadcaster);
    });

    it("allows registering event listeners on wsBroadcaster", async () => {
        let broadcastCalled = false;
        let boardEvent: any = null;

        const unsubscribe1 = () => wsBroadcaster.off("broadcast", onBroadcast);
        const onBroadcast = () => { broadcastCalled = true; };
        wsBroadcaster.on("broadcast", onBroadcast);

        const onBoard = (data: any) => { boardEvent = data; };
        wsBroadcaster.on("board:test_board_1", onBoard);

        await wsBroadcaster.broadcast("test_board_1", {
            type: "card:moved",
            payload: { cardId: "card_abc", sourceList: "list_1", destList: "list_2", position: 1 }
        });

        expect(broadcastCalled).toBe(true);
        expect(boardEvent).not.toBeNull();
        expect(boardEvent.type).toBe("card:moved");
        expect(boardEvent.payload.cardId).toBe("card_abc");

        unsubscribe1();
        wsBroadcaster.off("board:test_board_1", onBoard);
    });

    it("broadcast helpers generate correct dictionary shapes", async () => {
        let lastEvent: any = null;
        const handler = (evt: any) => { lastEvent = evt; };
        wsBroadcaster.on("board:board_event_test", handler);

        await wsBroadcaster.broadcastCardCreated("board_event_test", { id: "card_1", title: "New Task" });
        expect(lastEvent.type).toBe("card:created");
        expect(lastEvent.payload.cardData.title).toBe("New Task");

        await wsBroadcaster.broadcastCardUpdated("board_event_test", "card_1", { title: "Updated Task" });
        expect(lastEvent.type).toBe("card:updated");
        expect(lastEvent.payload.cardId).toBe("card_1");
        expect(lastEvent.payload.updates.title).toBe("Updated Task");

        await wsBroadcaster.broadcastCardDeleted("board_event_test", "card_1");
        expect(lastEvent.type).toBe("card:deleted");
        expect(lastEvent.payload.cardId).toBe("card_1");

        await wsBroadcaster.broadcastListReordered("board_event_test", "list_1", 2);
        expect(lastEvent.type).toBe("list:reordered");
        expect(lastEvent.payload.listId).toBe("list_1");
        expect(lastEvent.payload.newPosition).toBe(2);

        await wsBroadcaster.broadcastUserJoined("board_event_test", { userId: "user_1", name: "Alice" });
        expect(lastEvent.type).toBe("user:joined");
        expect(lastEvent.payload.userId).toBe("user_1");

        await wsBroadcaster.broadcastUserLeft("board_event_test", "user_1");
        expect(lastEvent.type).toBe("user:left");
        expect(lastEvent.payload.userId).toBe("user_1");

        wsBroadcaster.off("board:board_event_test", handler);
    });

    it("verifies intra-column card moves (same column, new position) produce card:moved payload", async () => {
        let moveEvent: any = null;
        const handler = (evt: any) => { moveEvent = evt; };
        wsBroadcaster.on("board:board_same_col", handler);

        await wsBroadcaster.broadcastCardMoved("board_same_col", {
            cardId: "card_reordered",
            sourceList: "column_alpha",
            destList: "column_alpha",
            position: 3
        });

        expect(moveEvent).not.toBeNull();
        expect(moveEvent.type).toBe("card:moved");
        expect(moveEvent.payload.cardId).toBe("card_reordered");
        expect(moveEvent.payload.sourceList).toBe("column_alpha");
        expect(moveEvent.payload.destList).toBe("column_alpha");
        expect(moveEvent.payload.position).toBe(3);

        wsBroadcaster.off("board:board_same_col", handler);
    });

    it("verifies list lifecycle broadcasts (list:created, list:updated, list:deleted)", async () => {
        const events: any[] = [];
        const handler = (evt: any) => { events.push(evt); };
        wsBroadcaster.on("board:board_list_test", handler);

        await wsBroadcaster.broadcast("board_list_test", {
            type: "list:created",
            payload: { listData: { id: "col_1", title: "To Do" } }
        });

        await wsBroadcaster.broadcast("board_list_test", {
            type: "list:updated",
            payload: { listId: "col_1", title: "In Progress" }
        });

        await wsBroadcaster.broadcast("board_list_test", {
            type: "list:deleted",
            payload: { listId: "col_1" }
        });

        expect(events.length).toBe(3);
        expect(events[0].type).toBe("list:created");
        expect(events[0].payload.listData.title).toBe("To Do");
        expect(events[1].type).toBe("list:updated");
        expect(events[1].payload.title).toBe("In Progress");
        expect(events[2].type).toBe("list:deleted");
        expect(events[2].payload.listId).toBe("col_1");

        wsBroadcaster.off("board:board_list_test", handler);
    });

    it("handles non-string, empty, or whitespace boardIds gracefully by returning false without emitting or throwing", async () => {
        const invalidBoardIds = [12345, 0, false, true, null, undefined, {}, [], "", "   "];
        for (const badId of invalidBoardIds) {
            const res = await wsBroadcaster.broadcast(badId as any, { type: "test", payload: {} });
            expect(res).toBe(false);
        }
    });
});
