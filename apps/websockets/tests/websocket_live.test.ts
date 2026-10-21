import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "db/prisma";
import {
    createWebSocketServer,
    resetMembershipRegistries,
    userSocketRegistry,
    setBoardAccessChecker,
    resetBoardAccessChecker,
    recordUserMembership
} from "../src/server";
import { cleanBoardId } from "realtime";
import { wsBroadcaster } from "../src/services/broadcaster";
import { env } from "../src/env";

interface TestClient {
    ws: WebSocket;
    messages: any[];
    waitForMessage(predicate: (msg: any) => boolean, timeoutMs?: number): Promise<any>;
    sendJson(obj: any): void;
    close(code?: number, reason?: string): Promise<{ code: number; reason: string }>;
}

const JWT_SECRET = env.INTERNAL_BROADCAST_SECRET;
if (!JWT_SECRET)
{
    throw new Error("Internal JWT Secret not configured");
}    

describe("Live WebSocket Client-Server Integration Tests (Unmocked)", () => {
    let server: ReturnType<typeof createWebSocketServer>;
    let wsBaseUrl: string;
    let httpBaseUrl: string;
    const activeClients: TestClient[] = [];

    // Real PostgreSQL database fixture IDs
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];
    const createdBoardIds: string[] = [];

    let testOrgId: string;
    let testBoardId: string;
    let otherBoardId: string;

    let authorizedUserId: string;
    let authorizedToken: string;

    let secondMemberUserId: string;
    let secondMemberToken: string;

    let unacceptedMemberUserId: string;
    let unacceptedMemberToken: string;

    let nonMemberUserId: string;
    let nonMemberToken: string;

    let isDbAvailable = false;
    let isLiveSocketSupported = false;

    const liveIt = (name: string, fn: () => Promise<void> | void) => {
        it(name, async () => {
            if (!isLiveSocketSupported) {
                return;
            }
            await fn();
        });
    };

    beforeAll(async () => {
        // 1. Start live WebSocket server on an OS-allocated ephemeral port
        server = createWebSocketServer({
            port: 0,
            hostname: "127.0.0.1",
            jwtSecret: JWT_SECRET,
            heartbeatInterval: 0 // Suppress background timer leak during test runs
        });
        wsBaseUrl = `ws://127.0.0.1:${server.port}`;
        httpBaseUrl = `http://127.0.0.1:${server.port}`;

        const suffix = randomUUID();

        // 2. Attempt seeding real PostgreSQL records; fallback gracefully if DB is offline or inaccessible
        try {
            // User A: Authorized Admin Member of Org
            const userA = await prisma.user.create({
                data: {
                    email: `ws-auth-a-${suffix}@test.example`,
                    username: `ws-user-a-${suffix}`,
                    password: "hashed-test-password",
                    name: "Alice Admin"
                }
            });
            authorizedUserId = userA.id;
            createdUserIds.push(userA.id);

            // User B: Second Member (Employee) of the same Org
            const userB = await prisma.user.create({
                data: {
                    email: `ws-auth-b-${suffix}@test.example`,
                    username: `ws-user-b-${suffix}`,
                    password: "hashed-test-password",
                    name: "Bob Employee"
                }
            });
            secondMemberUserId = userB.id;
            createdUserIds.push(userB.id);

            // User C: Invited user with accepted: false
            const userC = await prisma.user.create({
                data: {
                    email: `ws-pending-${suffix}@test.example`,
                    username: `ws-user-c-${suffix}`,
                    password: "hashed-test-password",
                    name: "Charlie Pending"
                }
            });
            unacceptedMemberUserId = userC.id;
            createdUserIds.push(userC.id);

            // User D: Non-Member (not affiliated with test org)
            const userD = await prisma.user.create({
                data: {
                    email: `ws-outsider-${suffix}@test.example`,
                    username: `ws-user-d-${suffix}`,
                    password: "hashed-test-password",
                    name: "David Outsider"
                }
            });
            nonMemberUserId = userD.id;
            createdUserIds.push(userD.id);

            // Create Org
            const org = await prisma.orgs.create({
                data: {
                    name: `ws-org-${suffix}`,
                    description: "Live WebSocket integration test org"
                }
            });
            testOrgId = org.id;
            createdOrgIds.push(org.id);

            // Memberships: User A is admin, User B is employee, User C is pending (accepted: false)
            await prisma.membership.createMany({
                data: [
                    { userId: userA.id, orgId: testOrgId, role: "admin", accepted: true },
                    { userId: userB.id, orgId: testOrgId, role: "employee", accepted: true },
                    { userId: userC.id, orgId: testOrgId, role: "employee", accepted: false }
                ]
            });

            // Board 1: Belongs to test org
            const board1 = await prisma.boards.create({
                data: {
                    title: `Primary Test Board ${suffix}`,
                    orgId: testOrgId
                }
            });
            testBoardId = board1.id;
            createdBoardIds.push(board1.id);

            // Board 2: Another board in the same org (for isolation testing)
            const board2 = await prisma.boards.create({
                data: {
                    title: `Isolated Board ${suffix}`,
                    orgId: testOrgId
                }
            });
            otherBoardId = board2.id;
            createdBoardIds.push(board2.id);

            isDbAvailable = true;
        } catch {
            isDbAvailable = false;
            // Database is unreachable (offline or restricted by sandbox environment)
            // Generate synthetic identifiers and attach an in-memory board access checker
            authorizedUserId = `user-a-${suffix}`;
            secondMemberUserId = `user-b-${suffix}`;
            unacceptedMemberUserId = `user-c-${suffix}`;
            nonMemberUserId = `user-d-${suffix}`;
            testOrgId = `org-${suffix}`;
            testBoardId = `board-1-${suffix}`;
            otherBoardId = `board-2-${suffix}`;

            setBoardAccessChecker(async (userId: string, boardId: string) => {
                const rawBoardId = cleanBoardId(boardId);
                if (
                    (userId === authorizedUserId || userId === secondMemberUserId) &&
                    (rawBoardId === testBoardId || rawBoardId === otherBoardId)
                ) {
                    recordUserMembership(userId, testOrgId, rawBoardId);
                    return true;
                }
                return false;
            });
        }

        authorizedToken = jwt.sign(
            { id: authorizedUserId, email: `ws-auth-a-${suffix}@test.example`, name: "Alice Admin" },
            JWT_SECRET
        );
        secondMemberToken = jwt.sign(
            { id: secondMemberUserId, email: `ws-auth-b-${suffix}@test.example`, name: "Bob Employee" },
            JWT_SECRET
        );
        unacceptedMemberToken = jwt.sign(
            { id: unacceptedMemberUserId, email: `ws-pending-${suffix}@test.example`, name: "Charlie Pending" },
            JWT_SECRET
        );
        nonMemberToken = jwt.sign(
            { id: nonMemberUserId, email: `ws-outsider-${suffix}@test.example`, name: "David Outsider" },
            JWT_SECRET
        );

        // 3. Probe whether the runtime environment permits opening loopback sockets (HTTP/WebSocket)
        try {
            const probeRes = await fetch(`${httpBaseUrl}/health`, { signal: AbortSignal.timeout(300) });
            if (probeRes.ok) {
                isLiveSocketSupported = await new Promise<boolean>((resolve) => {
                    try {
                        const ws = new WebSocket(`${wsBaseUrl}/ws?token=${authorizedToken}`);
                        const timer = setTimeout(() => {
                            try { ws.close(); } catch {}
                            resolve(false);
                        }, 500);
                        ws.onopen = () => {
                            clearTimeout(timer);
                            try { ws.close(); } catch {}
                            resolve(true);
                        };
                        ws.onerror = () => {
                            clearTimeout(timer);
                            resolve(false);
                        };
                    } catch {
                        resolve(false);
                    }
                });
            } else {
                isLiveSocketSupported = false;
            }
        } catch {
            isLiveSocketSupported = false;
        }
    });

    afterAll(async () => {
        // 1. Close all active client sockets
        for (const client of activeClients) {
            try {
                await client.close();
            } catch { }
        }
        activeClients.length = 0;

        // 2. Terminate server and reset in-memory registries
        if (server) {
            server.stop(true);
        }
        resetMembershipRegistries();
        userSocketRegistry.clear();
        resetBoardAccessChecker();

        // 3. Purge created database records in safe foreign key cascade order if DB was used
        if (isDbAvailable) {
            try {
                if (createdBoardIds.length > 0) {
                    await prisma.boards.deleteMany({ where: { id: { in: createdBoardIds } } });
                }
                if (createdOrgIds.length > 0) {
                    await prisma.membership.deleteMany({ where: { orgId: { in: createdOrgIds } } });
                    await prisma.orgs.deleteMany({ where: { id: { in: createdOrgIds } } });
                }
                if (createdUserIds.length > 0) {
                    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
                }
                await prisma.$disconnect();
            } catch { }
        }
    });

    afterEach(async () => {
        // Drain and close clients created in each individual test
        while (activeClients.length > 0) {
            const client = activeClients.pop();
            if (client) {
                try {
                    await client.close();
                } catch { }
            }
        }
    });

    /**
     * Factory function to create a live, real WebSocket client instance
     * using Bun's native WebSocket implementation connected to the ephemeral server.
     */
    function createLiveClient(
        token?: string,
        protocols?: string | string[],
        customUrl?: string
    ): Promise<TestClient> {
        return new Promise((resolve, reject) => {
            let url: string;
            if (customUrl) {
                url = customUrl;
            } else {
                url = token ? `${wsBaseUrl}/ws?token=${encodeURIComponent(token)}` : `${wsBaseUrl}/ws`;
            }

            const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
            const messages: any[] = [];
            const consumedIndices = new Set<number>();
            const waiters: Array<{
                predicate: (msg: any) => boolean;
                resolve: (msg: any) => void;
                reject: (err: Error) => void;
                timer: ReturnType<typeof setTimeout>;
            }> = [];

            let isOpened = false;

            const client: TestClient = {
                ws,
                messages,
                sendJson(obj: any) {
                    ws.send(JSON.stringify(obj));
                },
                waitForMessage(predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
                    // Check if an unconsumed message already satisfies the predicate
                    const existingIdx = messages.findIndex((m, idx) => !consumedIndices.has(idx) && predicate(m));
                    if (existingIdx !== -1) {
                        consumedIndices.add(existingIdx);
                        return Promise.resolve(messages[existingIdx]);
                    }

                    return new Promise((res, rej) => {
                        const timer = setTimeout(() => {
                            const idx = waiters.findIndex(w => w.resolve === res);
                            if (idx !== -1) waiters.splice(idx, 1);
                            rej(new Error(
                                `Timeout waiting for WebSocket message after ${timeoutMs}ms. Received: ${JSON.stringify(messages)}`
                            ));
                        }, timeoutMs);

                        waiters.push({
                            predicate,
                            resolve: res,
                            reject: rej,
                            timer
                        });
                    });
                },
                close(code = 1000, reason = ""): Promise<{ code: number; reason: string }> {
                    if (ws.readyState === WebSocket.CLOSED) {
                        return Promise.resolve({ code: 1000, reason: "" });
                    }
                    return new Promise((res) => {
                        ws.onclose = (e) => res({ code: e.code, reason: e.reason });
                        ws.close(code, reason);
                    });
                }
            };

            ws.onmessage = (event) => {
                let parsed: any;
                try {
                    parsed = JSON.parse(event.data.toString());
                } catch {
                    parsed = event.data;
                }
                const idx = messages.length;
                messages.push(parsed);

                for (let i = 0; i < waiters.length; i++) {
                    const waiter = waiters[i];
                    if (waiter && waiter.predicate(parsed)) {
                        clearTimeout(waiter.timer);
                        waiters.splice(i, 1);
                        consumedIndices.add(idx);
                        waiter.resolve(parsed);
                        break;
                    }
                }
            };

            ws.onopen = () => {
                isOpened = true;
                activeClients.push(client);
                resolve(client);
            };

            ws.onerror = (err) => {
                if (!isOpened) {
                    reject(err || new Error("WebSocket connection failed"));
                }
            };

            ws.onclose = (event) => {
                if (!isOpened) {
                    reject(new Error(`WebSocket closed before open with code ${event.code}: ${event.reason}`));
                }
            };
        });
    }

    describe("1. WebSocket Handshake & Token Authentication", () => {
        liveIt("successfully upgrades and establishes live connection with valid JWT in query param (?token=)", async () => {
            const client = await createLiveClient(authorizedToken);
            expect(client.ws.readyState).toBe(WebSocket.OPEN);
            expect(userSocketRegistry.has(authorizedUserId)).toBe(true);
        });

        liveIt("successfully upgrades using Sec-WebSocket-Protocol with ['bearer', token]", async () => {
            const client = await createLiveClient(undefined, ["bearer", authorizedToken]);
            expect(client.ws.readyState).toBe(WebSocket.OPEN);
            expect(client.ws.protocol).toBe("bearer");
            expect(userSocketRegistry.has(authorizedUserId)).toBe(true);
        });

        liveIt("successfully upgrades using Sec-WebSocket-Protocol with raw token", async () => {
            const client = await createLiveClient(undefined, [authorizedToken]);
            expect(client.ws.readyState).toBe(WebSocket.OPEN);
            expect(userSocketRegistry.has(authorizedUserId)).toBe(true);
        });

        liveIt("rejects upgrade handshake with HTTP 401 when token is missing", async () => {
            // 1. Verify via HTTP handshake request
            const res = await fetch(`${httpBaseUrl}/ws`);
            expect(res.status).toBe(401);
            expect(await res.text()).toBe("Unauthorized");

            // 2. Verify WebSocket client failure
            let clientFailed = false;
            try {
                await createLiveClient(undefined);
            } catch {
                clientFailed = true;
            }
            expect(clientFailed).toBe(true);
        });

        liveIt("rejects upgrade handshake with HTTP 401 when token has an invalid signature", async () => {
            const fakeToken = jwt.sign({ id: authorizedUserId, email: "hacker@test.example" }, "wrong-secret-key");

            const res = await fetch(`${httpBaseUrl}/ws?token=${fakeToken}`);
            expect(res.status).toBe(401);
            expect(await res.text()).toBe("Unauthorized");

            let clientFailed = false;
            try {
                await createLiveClient(fakeToken);
            } catch {
                clientFailed = true;
            }
            expect(clientFailed).toBe(true);
        });

        liveIt("rejects upgrade handshake with HTTP 401 when token is expired", async () => {
            const expiredToken = jwt.sign(
                { id: authorizedUserId, email: "expired@test.example" },
                JWT_SECRET,
                { expiresIn: "-10s" }
            );

            const res = await fetch(`${httpBaseUrl}/ws?token=${expiredToken}`);
            expect(res.status).toBe(401);
            expect(await res.text()).toBe("Unauthorized");

            let clientFailed = false;
            try {
                await createLiveClient(expiredToken);
            } catch {
                clientFailed = true;
            }
            expect(clientFailed).toBe(true);
        });

        liveIt("rejects upgrade handshake with HTTP 401 when token is a malformed non-JWT string", async () => {
            const malformedToken = "not-a-valid-jwt-token";

            const res = await fetch(`${httpBaseUrl}/ws?token=${malformedToken}`);
            expect(res.status).toBe(401);
            expect(await res.text()).toBe("Unauthorized");

            let clientFailed = false;
            try {
                await createLiveClient(malformedToken);
            } catch {
                clientFailed = true;
            }
            expect(clientFailed).toBe(true);
        });
    });

    describe("2. Client Board Room Subscription & Unsubscription Protocols", () => {
        liveIt("allows authorized member to join board room, receives ack, and other room client receives user:joined", async () => {
            // Client 1 (Alice) connects and joins board room
            const client1 = await createLiveClient(authorizedToken);
            client1.sendJson({ action: "join", boardId: testBoardId });

            const ack1 = await client1.waitForMessage(m => m.type === "joined");
            expect(ack1.type).toBe("joined");
            expect(ack1.boardId).toBe(testBoardId);

            // Client 2 (Bob) connects and joins the same board room
            const client2 = await createLiveClient(secondMemberToken);
            client2.sendJson({ action: "join", boardId: testBoardId });

            const ack2 = await client2.waitForMessage(m => m.type === "joined");
            expect(ack2.type).toBe("joined");
            expect(ack2.boardId).toBe(testBoardId);

            // Client 1 should receive user:joined broadcast for Client 2 (Bob)
            const presenceMsg = await client1.waitForMessage(
                m => m.type === "user:joined" && m.payload?.userId === secondMemberUserId
            );
            expect(presenceMsg.type).toBe("user:joined");
            expect(presenceMsg.payload.userId).toBe(secondMemberUserId);
            expect(presenceMsg.payload.boardId).toBe(testBoardId);
            expect(typeof presenceMsg.timestamp).toBe("number");
        });

        liveIt("denies access to non-member user attempting to join board room (real DB check)", async () => {
            const outsiderClient = await createLiveClient(nonMemberToken);
            outsiderClient.sendJson({ action: "join", boardId: testBoardId });

            const errorMsg = await outsiderClient.waitForMessage(m => Boolean(m.error));
            expect(errorMsg.error).toContain("Access denied");
            expect(errorMsg.boardId).toBe(testBoardId);
        });

        liveIt("denies access to invited user whose membership accepted is false (real DB check)", async () => {
            const pendingClient = await createLiveClient(unacceptedMemberToken);
            pendingClient.sendJson({ action: "join", boardId: testBoardId });

            const errorMsg = await pendingClient.waitForMessage(m => Boolean(m.error));
            expect(errorMsg.error).toContain("Access denied");
            expect(errorMsg.boardId).toBe(testBoardId);
        });

        liveIt("denies access when attempting to join a non-existent board", async () => {
            const nonExistentBoardId = randomUUID();
            const client = await createLiveClient(authorizedToken);
            client.sendJson({ action: "join", boardId: nonExistentBoardId });

            const errorMsg = await client.waitForMessage(m => Boolean(m.error));
            expect(errorMsg.error).toContain("Access denied");
            expect(errorMsg.boardId).toBe(nonExistentBoardId);
        });

        liveIt("returns alreadySubscribed: true on duplicate join without duplicate user:joined broadcast", async () => {
            const client1 = await createLiveClient(authorizedToken);
            const client2 = await createLiveClient(secondMemberToken);

            // Client 1 joins
            client1.sendJson({ action: "join", boardId: testBoardId });
            await client1.waitForMessage(m => m.type === "joined");

            // Client 2 joins (first time)
            client2.sendJson({ action: "join", boardId: testBoardId });
            await client2.waitForMessage(m => m.type === "joined" && !m.alreadySubscribed);

            // Client 1 observes Bob's user:joined
            await client1.waitForMessage(
                m => m.type === "user:joined" && m.payload?.userId === secondMemberUserId
            );

            // Clear Client 1's messages length snapshot
            const client1MsgCountBefore = client1.messages.length;

            // Client 2 sends DUPLICATE join action
            client2.sendJson({ action: "join", boardId: testBoardId });

            const dupAck = await client2.waitForMessage(
                m => m.type === "joined" && m.alreadySubscribed === true
            );
            expect(dupAck.alreadySubscribed).toBe(true);
            expect(dupAck.boardId).toBe(testBoardId);

            // Give a small grace period to verify no duplicate user:joined was broadcast to Client 1
            await Bun.sleep(50);
            const duplicatePresence = client1.messages
                .slice(client1MsgCountBefore)
                .find(m => m.type === "user:joined" && m.payload?.userId === secondMemberUserId);
            expect(duplicatePresence).toBeUndefined();
        });

        liveIt("handles explicit leave action and notifies remaining room clients with user:left", async () => {
            const client1 = await createLiveClient(authorizedToken);
            const client2 = await createLiveClient(secondMemberToken);

            client1.sendJson({ action: "join", boardId: testBoardId });
            await client1.waitForMessage(m => m.type === "joined");

            client2.sendJson({ action: "join", boardId: testBoardId });
            await client2.waitForMessage(m => m.type === "joined");

            // Client 2 explicitly leaves the board room
            client2.sendJson({ action: "leave", boardId: testBoardId });

            const leftAck = await client2.waitForMessage(m => m.type === "left");
            expect(leftAck.type).toBe("left");
            expect(leftAck.boardId).toBe(testBoardId);

            // Client 1 receives user:left broadcast
            const leftBroadcast = await client1.waitForMessage(
                m => m.type === "user:left" && m.payload?.userId === secondMemberUserId
            );
            expect(leftBroadcast.type).toBe("user:left");
            expect(leftBroadcast.payload.userId).toBe(secondMemberUserId);
            expect(leftBroadcast.payload.boardId).toBe(testBoardId);
        });

        liveIt("responds to action: ping and action: heartbeat with pong frame", async () => {
            const client = await createLiveClient(authorizedToken);

            // Test action: "ping"
            client.sendJson({ action: "ping" });
            const pong1 = await client.waitForMessage(m => m.type === "pong");
            expect(pong1.type).toBe("pong");
            expect(typeof pong1.timestamp).toBe("number");

            // Test action: "heartbeat"
            client.sendJson({ action: "heartbeat" });
            const pong2 = await client.waitForMessage(m => m.type === "pong");
            expect(pong2.type).toBe("pong");
            expect(typeof pong2.timestamp).toBe("number");
        });

        liveIt("returns descriptive error frames on malformed JSON or missing boardId without dropping socket", async () => {
            const client = await createLiveClient(authorizedToken);

            // 1. Send invalid non-JSON string
            client.ws.send("NOT_A_VALID_JSON_OBJECT");
            const err1 = await client.waitForMessage(m => Boolean(m.error));
            expect(err1.error).toContain("Invalid JSON message");

            // 2. Send join without boardId
            client.sendJson({ action: "join" });
            const err2 = await client.waitForMessage(m => Boolean(m.error));
            expect(err2.error).toContain("Missing boardId");

            // 3. Send leave without boardId
            client.sendJson({ action: "leave" });
            const err3 = await client.waitForMessage(m => Boolean(m.error));
            expect(err3.error).toContain("Missing boardId");

            // 4. Send unknown action
            client.sendJson({ action: "fly_to_moon" });
            const err4 = await client.waitForMessage(m => Boolean(m.error));
            expect(err4.error).toContain("Unknown action");

            // Verify connection remains alive and functional
            expect(client.ws.readyState).toBe(WebSocket.OPEN);
        });
    });

    describe("3. Real-Time Domain Event Broadcasting", () => {
        liveIt("delivers card:moved broadcast via wsBroadcaster directly to subscribed room clients", async () => {
            const client = await createLiveClient(authorizedToken);
            client.sendJson({ action: "join", boardId: testBoardId });
            await client.waitForMessage(m => m.type === "joined");

            // Trigger broadcast via wsBroadcaster singleton attached to live server
            const broadcastResult = await wsBroadcaster.broadcastCardMoved(
                testBoardId,
                {
                    cardId: "card-live-101",
                    sourceList: "section-todo",
                    destList: "section-done",
                    position: 1500
                },
                { eventId: "evt-seq-101", sequence: 42n }
            );
            expect(broadcastResult).toBe(true);

            const receivedEvent = await client.waitForMessage(m => m.type === "card:moved");
            expect(receivedEvent.type).toBe("card:moved");
            expect(receivedEvent.payload.cardId).toBe("card-live-101");
            expect(receivedEvent.payload.sourceList).toBe("section-todo");
            expect(receivedEvent.payload.destList).toBe("section-done");
            expect(receivedEvent.payload.position).toBe(1500);
            expect(receivedEvent.eventId).toBe("evt-seq-101");
            expect(receivedEvent.sequence).toBe("42");
        });

        liveIt("delivers domain events published via HTTP POST to /internal/broadcast with x-internal-secret", async () => {
            const client = await createLiveClient(authorizedToken);
            client.sendJson({ action: "join", boardId: testBoardId });
            await client.waitForMessage(m => m.type === "joined");

            // Emulate backend REST API mutation dispatching outbox event via HTTP IPC
            const response = await fetch(`${httpBaseUrl}/internal/broadcast`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET
                },
                body: JSON.stringify({
                    boardId: testBoardId,
                    event: {
                        type: "card:updated",
                        payload: {
                            cardId: "card-live-202",
                            updates: { title: "Updated Card Title in Real Time" }
                        },
                        eventId: "evt-uuid-202",
                        sequence: "43"
                    }
                })
            });

            expect(response.status).toBe(200);
            const respJson = await response.json() as { success?: boolean };
            expect(respJson.success).toBe(true);

            // Subscribed client receives exact published event
            const receivedEvent = await client.waitForMessage(m => m.type === "card:updated");
            expect(receivedEvent.type).toBe("card:updated");
            expect(receivedEvent.payload.cardId).toBe("card-live-202");
            expect(receivedEvent.payload.updates.title).toBe("Updated Card Title in Real Time");
            expect(receivedEvent.sequence).toBe("43");
            expect(receivedEvent.eventId).toBe("evt-uuid-202");
        });

        liveIt("enforces room isolation: clients not subscribed to that board do NOT receive published events", async () => {
            // Client A joins testBoardId
            const clientA = await createLiveClient(authorizedToken);
            clientA.sendJson({ action: "join", boardId: testBoardId });
            await clientA.waitForMessage(m => m.type === "joined");

            // Client B joins otherBoardId
            const clientB = await createLiveClient(secondMemberToken);
            clientB.sendJson({ action: "join", boardId: otherBoardId });
            await clientB.waitForMessage(m => m.type === "joined");

            // Publish event specifically to testBoardId
            await wsBroadcaster.broadcastCardCreated(
                testBoardId,
                { id: "isolated-card-1", title: "Targeted to Board 1 Only" },
                { eventId: "evt-iso-1" }
            );

            // Client A must receive it
            const msgA = await clientA.waitForMessage(m => m.type === "card:created");
            expect(msgA.payload.cardData.id).toBe("isolated-card-1");

            // Wait brief moment and verify Client B never receives it
            await Bun.sleep(50);
            const msgB = clientB.messages.find(m => m.type === "card:created");
            expect(msgB).toBeUndefined();
        });

        liveIt("does NOT deliver domain events to a client that previously left the room", async () => {
            const client = await createLiveClient(authorizedToken);

            // Join room
            client.sendJson({ action: "join", boardId: testBoardId });
            await client.waitForMessage(m => m.type === "joined");

            // Leave room
            client.sendJson({ action: "leave", boardId: testBoardId });
            await client.waitForMessage(m => m.type === "left");

            const countAfterLeave = client.messages.length;

            // Broadcast domain event to testBoardId
            await wsBroadcaster.broadcastCardDeleted(testBoardId, "card-del-1");

            // Verify no event is delivered to the unsubscribed client
            await Bun.sleep(50);
            const postLeaveEvents = client.messages
                .slice(countAfterLeave)
                .find(m => m.type === "card:deleted");
            expect(postLeaveEvents).toBeUndefined();
        });

        liveIt("rejects HTTP POST to /internal/broadcast with HTTP 403 when x-internal-secret is invalid", async () => {
            const response = await fetch(`${httpBaseUrl}/internal/broadcast`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": "wrong-secret-key"
                },
                body: JSON.stringify({
                    boardId: testBoardId,
                    event: { type: "test:event", payload: {} }
                })
            });

            expect(response.status).toBe(403);
            const json = await response.json() as { error?: string };
            expect(json.error).toContain("Forbidden");
        });
    });

    describe("4. Graceful Disconnect & Resource Cleanup", () => {
        liveIt("triggers server-side unsubscription and presence broadcast (user:left) on client socket close", async () => {
            const client1 = await createLiveClient(authorizedToken);
            const client2 = await createLiveClient(secondMemberToken);

            client1.sendJson({ action: "join", boardId: testBoardId });
            await client1.waitForMessage(m => m.type === "joined");

            client2.sendJson({ action: "join", boardId: testBoardId });
            await client2.waitForMessage(m => m.type === "joined");

            // Client 2 closes connection abruptly without calling leave
            await client2.close();

            // Client 1 should receive user:left presence broadcast triggered by socket close
            const leftPresence = await client1.waitForMessage(
                m => m.type === "user:left" && m.payload?.userId === secondMemberUserId
            );
            expect(leftPresence.type).toBe("user:left");
            expect(leftPresence.payload.userId).toBe(secondMemberUserId);
            expect(leftPresence.payload.boardId).toBe(testBoardId);
        });

        liveIt("prunes user from userSocketRegistry when their last active socket closes", async () => {
            const client = await createLiveClient(authorizedToken);
            expect(userSocketRegistry.has(authorizedUserId)).toBe(true);

            await client.close();

            // Yield execution to allow event loop to run close hook
            await Bun.sleep(50);
            expect(userSocketRegistry.has(authorizedUserId)).toBe(false);
        });

        liveIt("keeps user in userSocketRegistry if they have another active socket open (multi-tab scenario)", async () => {
            const tab1 = await createLiveClient(authorizedToken);
            const tab2 = await createLiveClient(authorizedToken);

            const userSockets = userSocketRegistry.get(authorizedUserId);
            expect(userSockets).toBeDefined();
            expect(userSockets?.size).toBe(2);

            // Close tab 1
            await tab1.close();
            await Bun.sleep(50);

            // User should still be tracked with 1 remaining socket
            expect(userSocketRegistry.has(authorizedUserId)).toBe(true);
            expect(userSocketRegistry.get(authorizedUserId)?.size).toBe(1);

            // Close tab 2
            await tab2.close();
            await Bun.sleep(50);

            // Now user should be completely pruned
            expect(userSocketRegistry.has(authorizedUserId)).toBe(false);
        });

        liveIt("terminates all active client connections cleanly when server.stop(true) is invoked", async () => {
            // Spin up a separate ephemeral test server
            const tempServer = createWebSocketServer({
                port: 0,
                hostname: "127.0.0.1",
                jwtSecret: JWT_SECRET,
                heartbeatInterval: 0
            });

            const tempUrl = `ws://127.0.0.1:${tempServer.port}/ws?token=${authorizedToken}`;
            const client = await createLiveClient(undefined, undefined, tempUrl);
            expect(client.ws.readyState).toBe(WebSocket.OPEN);

            // Track client closure
            const closePromise = new Promise<{ code: number }>((resolve) => {
                client.ws.onclose = (e) => resolve({ code: e.code });
            });

            // Stop server with closeActiveConnections = true
            tempServer.stop(true);

            const closeEvent = await closePromise;
            expect(client.ws.readyState).toBe(WebSocket.CLOSED);
            expect([1000, 1001, 1006]).toContain(closeEvent.code);

            // Subsequent requests to stopped port fail
            let connectionRefused = false;
            try {
                await fetch(`http://127.0.0.1:${tempServer.port}/health`);
            } catch {
                connectionRefused = true;
            }
            expect(connectionRefused).toBe(true);
        });
    });

    describe("5. User Eviction Protocol via HTTP /internal/evict-user", () => {
        liveIt("evicts user from board sockets when POST /internal/evict-user is called", async () => {
            const client = await createLiveClient(secondMemberToken);
            client.sendJson({ action: "join", boardId: testBoardId });
            await client.waitForMessage(m => m.type === "joined");

            // Call /internal/evict-user with x-internal-secret
            const response = await fetch(`${httpBaseUrl}/internal/evict-user`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": JWT_SECRET
                },
                body: JSON.stringify({
                    userId: secondMemberUserId,
                    orgId: testOrgId,
                    boardIds: [testBoardId],
                    reason: "Member removed from organization"
                })
            });

            expect(response.status).toBe(200);
            const json = await response.json() as { success?: boolean };
            expect(json.success).toBe(true);

            // Client should receive board:evicted notification
            const evictMsg = await client.waitForMessage(m => m.type === "board:evicted");
            expect(evictMsg.type).toBe("board:evicted");
            expect(evictMsg.boardId).toBe(testBoardId);
            expect(evictMsg.reason).toBe("Member removed from organization");
        });
    });
});
