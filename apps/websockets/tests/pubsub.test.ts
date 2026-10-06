import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
    handleWebSocketClose,
    handleWebSocketMessage,
    setBoardAccessChecker,
    resetBoardAccessChecker,
    defaultCheckBoardAccess
} from "../src/server";
import { type WebSocketData, formatBoardTopic, cleanBoardId } from "../src/types/events";

describe("Native Pub/Sub & Board Room Management Tests", () => {
    beforeEach(() => {
        setBoardAccessChecker(() => true);
    });

    afterAll(() => {
        resetBoardAccessChecker();
    });
    function createMockSocket(userId = "user_456", email?: string, name?: string) {
        const finalEmail = arguments.length > 1 ? email : "bob@test.com";
        const subscriptions = new Set<string>();
        const sentMessages: string[] = [];
        const subscribedTopics: string[] = [];
        const unsubscribedTopics: string[] = [];

        const ws = {
            data: {
                userId,
                email: finalEmail,
                name,
                subscriptions,
                connectedAt: Date.now()
            } as WebSocketData,
            subscribe: mock((topic: string) => {
                subscribedTopics.push(topic);
                return true;
            }),
            unsubscribe: mock((topic: string) => {
                unsubscribedTopics.push(topic);
                return true;
            }),
            send: mock((msg: string) => {
                sentMessages.push(msg);
                return 1;
            }),
            getSentMessages() {
                return sentMessages;
            },
            getSubscribedTopics() {
                return subscribedTopics;
            },
            getUnsubscribedTopics() {
                return unsubscribedTopics;
            }
        };

        return ws;
    }

    function createMockServer() {
        const publishedEvents: { topic: string; message: string }[] = [];
        const server = {
            publish: mock((topic: string, message: string) => {
                publishedEvents.push({ topic, message });
                return 1;
            }),
            getPublishedEvents() {
                return publishedEvents;
            }
        };
        return server;
    }

    it("handles join action by subscribing ws and broadcasting user:joined", () => {
        const ws = createMockSocket("user_999", "carol@test.com", "Carol Danvers");
        const server = createMockServer();

        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "board_123",
            name: "Carol Danvers"
        }));

        // Socket subscribed
        expect(ws.subscribe).toHaveBeenCalled();
        expect(ws.getSubscribedTopics()).toContain("board_123");
        expect(ws.data.subscriptions.has("board_123")).toBe(true);

        // Sender receives confirmation
        const sent = ws.getSentMessages();
        expect(sent.length).toBe(1);
        const confirmation = JSON.parse(sent[0]!);
        expect(confirmation.type).toBe("joined");
        expect(confirmation.boardId).toBe("board_123");

        // Board room receives user:joined notification
        const published = server.getPublishedEvents();
        expect(published.length).toBeGreaterThan(0);
        const joinBroadcast = JSON.parse(published[0]!.message);
        expect(joinBroadcast.type).toBe("user:joined");
        expect(joinBroadcast.payload.userId).toBe("user_999");
        expect(joinBroadcast.payload.name).toBe("Carol Danvers");
        expect(joinBroadcast.payload.boardId).toBe("board_123");
    });

    it("user:joined strictly uses authenticated identity (name, email, userId) and completely ignores client-supplied name", () => {
        // Case 1: ws.data.name is present - client-supplied name must be completely ignored
        {
            const ws = createMockSocket("user_101", "alice@example.com", "Alice Real");
            const server = createMockServer();

            handleWebSocketMessage(ws, server, JSON.stringify({
                action: "join",
                boardId: "board_100",
                name: "Spoofed Admin Name"
            }));

            const published = server.getPublishedEvents();
            expect(published.length).toBe(1);
            const payload = JSON.parse(published[0]!.message).payload;
            expect(payload.name).toBe("Alice Real");
            expect(payload.userId).toBe("user_101");
            expect(payload.email).toBe("alice@example.com");
        }

        // Case 2: ws.data.name is undefined - falls back to ws.data.email, client-supplied name ignored
        {
            const ws = createMockSocket("user_102", "bob@example.com", undefined);
            const server = createMockServer();

            handleWebSocketMessage(ws, server, JSON.stringify({
                action: "join",
                boardId: "board_200",
                name: "Hacker Display Name"
            }));

            const published = server.getPublishedEvents();
            expect(published.length).toBe(1);
            const payload = JSON.parse(published[0]!.message).payload;
            expect(payload.name).toBe("bob@example.com");
            expect(payload.userId).toBe("user_102");
        }

        // Case 3: both ws.data.name and ws.data.email are undefined - falls back to ws.data.userId, client-supplied name ignored
        {
            const ws = createMockSocket("user_103", undefined, undefined);
            const server = createMockServer();

            handleWebSocketMessage(ws, server, JSON.stringify({
                action: "join",
                boardId: "board_300",
                name: "Attacker Name"
            }));

            const published = server.getPublishedEvents();
            expect(published.length).toBe(1);
            const payload = JSON.parse(published[0]!.message).payload;
            expect(payload.name).toBe("user_103");
            expect(payload.userId).toBe("user_103");
            expect(payload.email).toBeUndefined();
        }

        // Case 4: subscribe action alias with client-supplied name ignored
        {
            const ws = createMockSocket("user_104", "sub_user@example.com", "Verified Subscriber");
            const server = createMockServer();

            handleWebSocketMessage(ws, server, JSON.stringify({
                action: "subscribe",
                boardId: "board_400",
                name: "Fake Alias Name"
            }));

            const published = server.getPublishedEvents();
            expect(published.length).toBe(1);
            const payload = JSON.parse(published[0]!.message).payload;
            expect(payload.name).toBe("Verified Subscriber");
            expect(payload.userId).toBe("user_104");
            expect(payload.email).toBe("sub_user@example.com");
        }

        // Case 5: ws.data.name is empty string - falls back to ws.data.email
        {
            const ws = createMockSocket("user_105", "empty_name@example.com", "");
            const server = createMockServer();

            handleWebSocketMessage(ws, server, JSON.stringify({
                action: "join",
                boardId: "board_500",
                name: "Fake Display Name"
            }));

            const published = server.getPublishedEvents();
            expect(published.length).toBe(1);
            const payload = JSON.parse(published[0]!.message).payload;
            expect(payload.name).toBe("empty_name@example.com");
            expect(payload.userId).toBe("user_105");
        }
    });

    it("handles subscribe alias for join action", () => {
        const ws = createMockSocket();
        const server = createMockServer();

        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "subscribe",
            boardId: "board_xyz"
        }));

        expect(ws.data.subscriptions.has("board_xyz")).toBe(true);
        const sent = JSON.parse(ws.getSentMessages()[0]!);
        expect(sent.type).toBe("joined");
    });

    it("normalizes boardId without board_ prefix", () => {
        const ws = createMockSocket();
        const server = createMockServer();

        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "uuid-1234"
        }));

        // Subscribes to formatted topic "board_uuid-1234" and raw "uuid-1234"
        expect(ws.data.subscriptions.has("board_uuid-1234")).toBe(true);
    });

    it("sends error if join is missing boardId", () => {
        const ws = createMockSocket();
        const server = createMockServer();

        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join"
        }));

        expect(ws.subscribe).not.toHaveBeenCalled();
        const sent = JSON.parse(ws.getSentMessages()[0]!);
        expect(sent.error).toContain("Missing boardId");
    });

    it("handles leave action by unsubscribing ws and broadcasting user:left", () => {
        const ws = createMockSocket("user_999");
        const server = createMockServer();

        // First join
        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "board_123"
        }));
        expect(ws.data.subscriptions.has("board_123")).toBe(true);

        // Now leave
        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "leave",
            boardId: "board_123"
        }));

        expect(ws.unsubscribe).toHaveBeenCalled();
        expect(ws.data.subscriptions.has("board_123")).toBe(false);

        // Sender receives confirmation
        const sent = ws.getSentMessages();
        const leaveAck = JSON.parse(sent[sent.length - 1]!);
        expect(leaveAck.type).toBe("left");
        expect(leaveAck.boardId).toBe("board_123");

        // Room receives user:left notification
        const published = server.getPublishedEvents();
        const leaveBroadcast = JSON.parse(published[published.length - 1]!.message);
        expect(leaveBroadcast.type).toBe("user:left");
        expect(leaveBroadcast.payload.userId).toBe("user_999");
    });

    it("handles ping action with pong response", () => {
        const ws = createMockSocket();
        const server = createMockServer();

        handleWebSocketMessage(ws, server, JSON.stringify({ action: "ping" }));

        const sent = JSON.parse(ws.getSentMessages()[0]!);
        expect(sent.type).toBe("pong");
        expect(typeof sent.timestamp).toBe("number");
    });

    it("handles invalid JSON gracefully without throwing", () => {
        const ws = createMockSocket();
        const server = createMockServer();

        handleWebSocketMessage(ws, server, "{ invalid json");

        const sent = JSON.parse(ws.getSentMessages()[0]!);
        expect(sent.error).toBe("Invalid JSON message");
    });

    it("handles non-object JSON frames (null, number, string, array) safely without throwing", () => {
        const testCases = ["null", "123", '"plain_string"', "[1, 2, 3]"];
        for (const raw of testCases) {
            const ws = createMockSocket();
            const server = createMockServer();

            expect(() => handleWebSocketMessage(ws, server, raw)).not.toThrow();
            const sent = ws.getSentMessages();
            expect(sent.length).toBe(1);
            const parsed = JSON.parse(sent[0]!);
            expect(parsed.error).toBeDefined();
        }
    });

    it("handles non-string boardId for join action safely without throwing", () => {
        const invalidBoardIds = [12345, 0, -1, true, false, { id: "123" }, [1, 2]];
        for (const badBoardId of invalidBoardIds) {
            const ws = createMockSocket();
            const server = createMockServer();

            expect(() => handleWebSocketMessage(ws, server, JSON.stringify({
                action: "join",
                boardId: badBoardId
            }))).not.toThrow();

            expect(ws.subscribe).not.toHaveBeenCalled();
            const sent = ws.getSentMessages();
            expect(sent.length).toBe(1);
            const parsed = JSON.parse(sent[0]!);
            expect(parsed.error).toContain("Invalid boardId");
        }

        for (const emptyBoardId of ["", "   "]) {
            const ws = createMockSocket();
            const server = createMockServer();

            expect(() => handleWebSocketMessage(ws, server, JSON.stringify({
                action: "join",
                boardId: emptyBoardId
            }))).not.toThrow();

            expect(ws.subscribe).not.toHaveBeenCalled();
            const sent = ws.getSentMessages();
            expect(sent.length).toBe(1);
            const parsed = JSON.parse(sent[0]!);
            expect(parsed.error).toContain("Missing boardId");
        }
    });

    it("handles non-string boardId for leave action safely without throwing", () => {
        const invalidBoardIds = [12345, 0, -1, true, false, { id: "123" }, [1, 2]];
        for (const badBoardId of invalidBoardIds) {
            const ws = createMockSocket();
            const server = createMockServer();

            expect(() => handleWebSocketMessage(ws, server, JSON.stringify({
                action: "leave",
                boardId: badBoardId
            }))).not.toThrow();

            expect(ws.unsubscribe).not.toHaveBeenCalled();
            const sent = ws.getSentMessages();
            expect(sent.length).toBe(1);
            const parsed = JSON.parse(sent[0]!);
            expect(parsed.error).toContain("Invalid boardId");
        }

        for (const emptyBoardId of ["", "   "]) {
            const ws = createMockSocket();
            const server = createMockServer();

            expect(() => handleWebSocketMessage(ws, server, JSON.stringify({
                action: "leave",
                boardId: emptyBoardId
            }))).not.toThrow();

            expect(ws.unsubscribe).not.toHaveBeenCalled();
            const sent = ws.getSentMessages();
            expect(sent.length).toBe(1);
            const parsed = JSON.parse(sent[0]!);
            expect(parsed.error).toContain("Missing boardId");
        }
    });

    it("handles non-string action safely without throwing", () => {
        const ws = createMockSocket();
        const server = createMockServer();

        expect(() => handleWebSocketMessage(ws, server, JSON.stringify({
            action: 12345,
            boardId: "board_1"
        }))).not.toThrow();

        const sent = ws.getSentMessages();
        expect(sent.length).toBe(1);
        const parsed = JSON.parse(sent[0]!);
        expect(parsed.error).toContain("Unknown action");
    });

    it("broadcasts user:left on connection close for all active subscriptions with cleaned boardId", () => {
        const ws = createMockSocket("user_disconnecting");
        const server = createMockServer();

        // Simulate client having joined 2 boards
        ws.data.subscriptions.add("board_alpha");
        ws.data.subscriptions.add("board_beta");

        handleWebSocketClose(ws, server, 1000, "Normal closure");

        // Broadcasted user:left to both boards
        const published = server.getPublishedEvents();
        expect(published.length).toBe(2);

        const topics = published.map(p => p.topic);
        expect(topics).toContain("board_alpha");
        expect(topics).toContain("board_beta");

        const alphaEvent = JSON.parse(published.find(p => p.topic === "board_alpha")!.message);
        expect(alphaEvent.type).toBe("user:left");
        expect(alphaEvent.payload.userId).toBe("user_disconnecting");
        expect(alphaEvent.payload.boardId).toBe("alpha");

        const betaEvent = JSON.parse(published.find(p => p.topic === "board_beta")!.message);
        expect(betaEvent.type).toBe("user:left");
        expect(betaEvent.payload.userId).toBe("user_disconnecting");
        expect(betaEvent.payload.boardId).toBe("beta");

        // Subscriptions set cleared
        expect(ws.data.subscriptions.size).toBe(0);
    });

    it("handleWebSocketClose broadcasts user:left with cleaned boardId even if ws.unsubscribe throws", () => {
        const ws = createMockSocket("user_unsub_error", "unsub@test.com", "Unsub Tester");
        // Simulate ws.unsubscribe throwing (e.g. socket already terminated/closed by runtime)
        ws.unsubscribe = mock(() => {
            throw new Error("Cannot unsubscribe: WebSocket connection is already closed");
        });

        ws.data.subscriptions.add("board_123");
        ws.data.subscriptions.add("board_456_test");

        const server = createMockServer();

        // Must not throw
        expect(() => handleWebSocketClose(ws, server, 1006, "Abnormal closure")).not.toThrow();

        // user:left broadcasts must still succeed for all subscriptions with cleaned boardId
        const published = server.getPublishedEvents();
        expect(published.length).toBe(2);

        const event123 = JSON.parse(published.find(p => p.topic === "board_123")!.message);
        expect(event123.type).toBe("user:left");
        expect(event123.payload.boardId).toBe("123");
        expect(event123.payload.userId).toBe("user_unsub_error");
        expect(event123.payload.name).toBe("Unsub Tester");

        const event456 = JSON.parse(published.find(p => p.topic === "board_456_test")!.message);
        expect(event456.type).toBe("user:left");
        expect(event456.payload.boardId).toBe("456_test");

        // Subscriptions set must still be cleared
        expect(ws.data.subscriptions.size).toBe(0);
    });

    it("handleWebSocketClose publishes user:left before calling ws.unsubscribe in exact sequence", () => {
        const ws = createMockSocket("user_seq", "seq@test.com", "Sequence Tester");
        const server = createMockServer();
        const callOrder: string[] = [];

        server.publish = mock((topic: string, message: string) => {
            callOrder.push(`publish:${topic}`);
            return 1;
        });

        ws.unsubscribe = mock((topic: string) => {
            callOrder.push(`unsubscribe:${topic}`);
            return true;
        });

        ws.data.subscriptions.add("board_order_test");

        handleWebSocketClose(ws, server, 1000, "Clean close");

        expect(callOrder).toEqual(["publish:board_order_test", "unsubscribe:board_order_test"]);
    });

    it("handleWebSocketClose continues broadcasting remaining topics even if server.publish throws on one topic", () => {
        const ws = createMockSocket("user_partial_fail", "partial@test.com", "Partial Fail Tester");
        let publishAttempts = 0;
        const successfulTopics: string[] = [];

        const server = {
            publish: mock((topic: string, message: string) => {
                publishAttempts++;
                if (topic === "board_fail") {
                    throw new Error("Simulated socket write failure on board_fail");
                }
                successfulTopics.push(topic);
                return 1;
            })
        };

        ws.data.subscriptions.add("board_fail");
        ws.data.subscriptions.add("board_success");

        expect(() => handleWebSocketClose(ws, server as any, 1006, "Connection dropped")).not.toThrow();

        expect(publishAttempts).toBe(2);
        expect(successfulTopics).toContain("board_success");
        expect(ws.data.subscriptions.size).toBe(0);
    });

    it("handleWebSocketClose and handleWebSocketMessage handle missing ws.data gracefully", () => {
        const server = createMockServer();

        // Socket with missing ws.data or subscriptions must not throw
        expect(() => handleWebSocketClose({} as any, server)).not.toThrow();
        expect(() => handleWebSocketClose({ data: undefined } as any, server)).not.toThrow();

        const bareSocket = {
            send: mock((msg: string) => 1),
            data: undefined
        };
        expect(() => handleWebSocketMessage(bareSocket as any, server, JSON.stringify({ action: "join", boardId: "123" }))).not.toThrow();
        expect(bareSocket.send).toHaveBeenCalled();
        const sent = JSON.parse(bareSocket.send.mock.calls[0]![0] as string);
        expect(sent.error).toContain("Unauthenticated socket session");
    });

    it("prevents duplicate subscriptions and does not re-broadcast user:joined on repeated join", () => {
        const ws = createMockSocket("user_repeat", "repeat@test.com");
        const server = createMockServer();

        // First join
        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "board_dup_test"
        }));

        expect(ws.data.subscriptions.size).toBe(1);
        expect(ws.subscribe).toHaveBeenCalledTimes(1);
        expect(server.getPublishedEvents().length).toBe(1);

        // Second join to same board
        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "board_dup_test"
        }));

        // Should NOT call ws.subscribe again
        expect(ws.subscribe).toHaveBeenCalledTimes(1);
        // Subscriptions should still only have 1 entry
        expect(ws.data.subscriptions.size).toBe(1);
        // Server should NOT broadcast user:joined a second time
        expect(server.getPublishedEvents().length).toBe(1);

        // Should acknowledge with alreadySubscribed
        const sent = ws.getSentMessages();
        expect(sent.length).toBe(2);
        const secondAck = JSON.parse(sent[1]!);
        expect(secondAck.type).toBe("joined");
        expect(secondAck.alreadySubscribed).toBe(true);
    });

    it("subscribes strictly to canonical topic once without duplicate raw-and-prefixed topic subscriptions", () => {
        const ws = createMockSocket("user_canonical");
        const server = createMockServer();

        handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "raw_123"
        }));

        // Raw ID "raw_123" is normalized to "board_raw_123"
        expect(ws.getSubscribedTopics()).toEqual(["board_raw_123"]);
        expect(ws.data.subscriptions.size).toBe(1);
        expect(ws.data.subscriptions.has("board_raw_123")).toBe(true);
        expect(ws.data.subscriptions.has("raw_123")).toBe(false);

        // Server only publishes ONCE to the canonical topic
        const published = server.getPublishedEvents();
        expect(published.length).toBe(1);
        expect(published[0]!.topic).toBe("board_raw_123");
    });

    it("formatBoardTopic and cleanBoardId helpers handle valid, empty, non-string, and whitespace inputs", () => {
        expect(formatBoardTopic("board_123")).toBe("board_123");
        expect(formatBoardTopic("123")).toBe("board_123");
        expect(formatBoardTopic("  board_123  ")).toBe("board_123");
        expect(formatBoardTopic("  123  ")).toBe("board_123");
        expect(formatBoardTopic("")).toBe("");
        expect(formatBoardTopic("   ")).toBe("");
        expect(formatBoardTopic(12345 as any)).toBe("");
        expect(formatBoardTopic(0 as any)).toBe("");
        expect(formatBoardTopic(null as any)).toBe("");
        expect(formatBoardTopic(undefined as any)).toBe("");
        expect(formatBoardTopic({} as any)).toBe("");
        expect(formatBoardTopic(true as any)).toBe("");
        expect(formatBoardTopic(false as any)).toBe("");

        expect(cleanBoardId("board_123")).toBe("123");
        expect(cleanBoardId("123")).toBe("123");
        expect(cleanBoardId("  board_123  ")).toBe("123");
        expect(cleanBoardId("")).toBe("");
        expect(cleanBoardId("   ")).toBe("");
        expect(cleanBoardId(12345 as any)).toBe("");
        expect(cleanBoardId(0 as any)).toBe("");
        expect(cleanBoardId(null as any)).toBe("");
        expect(cleanBoardId(undefined as any)).toBe("");
        expect(cleanBoardId({} as any)).toBe("");
    });

    it("rejects join action when user is not an accepted member of the board's organization", async () => {
        setBoardAccessChecker((_userId, _boardId) => false);
        const ws = createMockSocket("attacker_user", "attacker@evil.com");
        const server = createMockServer();

        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "private_board_456"
        }));

        // Socket should NOT be subscribed
        expect(ws.subscribe).not.toHaveBeenCalled();
        expect(ws.getSubscribedTopics()).not.toContain("board_private_board_456");
        expect(ws.data.subscriptions.has("board_private_board_456")).toBe(false);

        // Server should NOT publish user:joined
        expect(server.getPublishedEvents().length).toBe(0);

        // Client receives error message
        const sent = ws.getSentMessages();
        expect(sent.length).toBe(1);
        const errorMsg = JSON.parse(sent[0]!);
        expect(errorMsg.error).toContain("Access denied");
        expect(errorMsg.boardId).toBe("private_board_456");
    });

    it("allows join action when user is authorized by async checker", async () => {
        setBoardAccessChecker(async (userId, boardId) => {
            return userId === "member_1" && boardId === "board_allowed";
        });
        const ws = createMockSocket("member_1", "member1@test.com");
        const server = createMockServer();

        await handleWebSocketMessage(ws, server, JSON.stringify({
            action: "join",
            boardId: "board_allowed"
        }));

        expect(ws.subscribe).toHaveBeenCalled();
        expect(ws.data.subscriptions.has("board_allowed")).toBe(true);
        expect(server.getPublishedEvents().length).toBe(1);
    });

    it("defaultCheckBoardAccess returns false for empty boardId or userId", async () => {
        expect(await defaultCheckBoardAccess("", "board_1")).toBe(false);
        expect(await defaultCheckBoardAccess("user_1", "")).toBe(false);
    });
});
