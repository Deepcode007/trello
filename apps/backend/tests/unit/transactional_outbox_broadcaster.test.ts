import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { WebSocketBroadcaster as BackendBroadcaster, wsBroadcaster } from "../../src/services/broadcaster";
import { WebSocketBroadcaster as WsBroadcaster } from "../../../websockets/src/services/broadcaster";

describe("Transactional Outbox Pattern & Monotonic Event Stream Suite", () =>
{
    const validBoardId = "44444444-4444-4444-8444-444444444444";
    const origTransaction = prisma.$transaction;
    const origBoardEvents = prisma.board_events;

    afterEach(() =>
    {
        prisma.$transaction = origTransaction;
        prisma.board_events = origBoardEvents;
    });

    describe("1. Transactional Tying of Mutations to Event Outbox", () =>
    {
        it("records event in the caller's transaction when tx is provided", async () =>
        {
            let advisoryLockCalled = false;
            let capturedData: any = null;

            const mockTx = {
                $executeRaw: mock(() =>
                {
                    advisoryLockCalled = true;
                    return Promise.resolve();
                }),
                board_events: {
                    findFirst: mock(() => Promise.resolve({ sequence: 20n })),
                    create: mock((args: any) =>
                    {
                        capturedData = args.data;
                        return Promise.resolve({
                            id: "evt-tx-1",
                            sequence: args.data.sequence
                        });
                    })
                }
            };

            const rec = await wsBroadcaster.recordBoardEvent(validBoardId, "card:created", { cardId: "c100" }, {
                tx: mockTx
            });

            expect(rec).not.toBeNull();
            expect(rec?.id).toBe("evt-tx-1");
            expect(rec?.sequence).toBe(21n);
            expect(advisoryLockCalled).toBe(true);
            expect(capturedData.sequence).toBe(21n);
            expect(capturedData.eventType).toBe("card:created");
            expect(capturedData.published).toBe(false);
            expect(capturedData.publishedAt).toBeNull();
        });

        it("throws and does NOT swallow errors when persistence fails inside a transaction", async () =>
        {
            const mockTx = {
                $executeRaw: mock(() => Promise.resolve()),
                board_events: {
                    findFirst: mock(() => Promise.resolve({ sequence: 1n })),
                    create: mock(() =>
                    {
                        throw new Error("DB unique sequence conflict or connection drop");
                    })
                }
            };

            await expect(
                wsBroadcaster.recordBoardEvent(validBoardId, "card:created", { cardId: "c-err" }, {
                    tx: mockTx
                })
            ).rejects.toThrow("DB unique sequence conflict or connection drop");
        });

        it("executeWithOutbox atomically executes mutation and outbox event inside same transaction", async () =>
        {
            let mutationExecuted = false;
            let capturedEventData: any = null;
            let publishedCalled = false;

            const broadcaster = new BackendBroadcaster();
            const mockServer = {
                port: 3001,
                publish: mock(() =>
                {
                    publishedCalled = true;
                    return 1;
                })
            };
            broadcaster.setServer(mockServer as any);

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 50n })),
                        create: mock((args: any) =>
                        {
                            capturedEventData = args.data;
                            return Promise.resolve({
                                id: "evt-atom-1",
                                sequence: args.data.sequence
                            });
                        }),
                        update: mock(() => Promise.resolve({ id: "evt-atom-1", published: true }))
                    }
                };
                return fn(tx);
            }) as any;

            prisma.board_events = {
                ...prisma.board_events,
                update: mock(() => Promise.resolve({ id: "evt-atom-1", published: true }))
            } as any;

            const res = await broadcaster.executeWithOutbox(
                validBoardId,
                { type: "card:moved", payload: { cardId: "c-tx", position: 500 } },
                async (tx) =>
                {
                    mutationExecuted = true;
                    return { updatedCardId: "c-tx" };
                }
            );

            expect(mutationExecuted).toBe(true);
            expect(res.result.updatedCardId).toBe("c-tx");
            expect(res.eventId).toBe("evt-atom-1");
            expect(res.sequence).toBe(51n);
            expect(capturedEventData.sequence).toBe(51n);
            expect(capturedEventData.published).toBe(false); // Initially false in outbox
            expect(publishedCalled).toBe(true);
            expect(res.published).toBe(true);
        });

        it("executeWithOutbox rolls back transaction if mutation fails", async () =>
        {
            const broadcaster = new BackendBroadcaster();

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 10n })),
                        create: mock(() => Promise.resolve({ id: "evt-should-not-exist", sequence: 11n }))
                    }
                };
                return fn(tx);
            }) as any;

            await expect(
                broadcaster.executeWithOutbox(
                    validBoardId,
                    { type: "card:created", payload: {} },
                    async () =>
                    {
                        throw new Error("Mutation validation failure");
                    }
                )
            ).rejects.toThrow("Mutation validation failure");
        });
    });

    describe("2. Outbox Persistence State & Post-Transport Publishing", () =>
    {
        it("records outbox event with published: false before transport", async () =>
        {
            let capturedData: any = null;

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 5n })),
                        create: mock((args: any) =>
                        {
                            capturedData = args.data;
                            return Promise.resolve({
                                id: "evt-unpub-1",
                                sequence: args.data.sequence
                            });
                        })
                    }
                };
                return fn(tx);
            }) as any;

            const rec = await wsBroadcaster.recordBoardEvent(validBoardId, "card:created", { cardId: "c1" });
            expect(rec).not.toBeNull();
            expect(capturedData.published).toBe(false);
            expect(capturedData.publishedAt).toBeNull();
        });

        it("marks event published ONLY AFTER transport succeeds", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            let markPublishedCalled = false;
            let markedEventId = "";

            const mockServer = {
                port: 3001,
                publish: mock(() => 1)
            };
            broadcaster.setServer(mockServer as any);

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 12n })),
                        create: mock((args: any) => Promise.resolve({
                            id: "evt-pub-mark",
                            sequence: args.data.sequence
                        }))
                    }
                };
                return fn(tx);
            }) as any;

            prisma.board_events = {
                ...prisma.board_events,
                update: mock((args: any) =>
                {
                    markPublishedCalled = true;
                    markedEventId = args.where.id;
                    return Promise.resolve({ id: args.where.id, published: true });
                })
            } as any;

            const success = await broadcaster.broadcast(validBoardId, {
                type: "card:updated",
                payload: { cardId: "c1", title: "New" }
            });

            expect(success).toBe(true);
            expect(markPublishedCalled).toBe(true);
            expect(markedEventId).toBe("evt-pub-mark");
        });

        it("leaves event unpublished (published: false) when transport fails", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            // Server is null and HTTP endpoint is offline
            broadcaster.setServer(null as any);
            broadcaster.setPort(9999); // nonexistent port

            let updateCalled = false;

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 15n })),
                        create: mock((args: any) => Promise.resolve({
                            id: "evt-failed-transport",
                            sequence: args.data.sequence
                        }))
                    }
                };
                return fn(tx);
            }) as any;

            prisma.board_events = {
                ...prisma.board_events,
                update: mock(() =>
                {
                    updateCalled = true;
                    return Promise.resolve({});
                })
            } as any;

            const success = await broadcaster.broadcast(validBoardId, {
                type: "card:deleted",
                payload: { cardId: "c-fail" }
            });

            expect(success).toBe(false);
            expect(updateCalled).toBe(false); // Did not mark published!
        });
    });

    describe("3. Retrying Pending Outbox Events", () =>
    {
        it("retryPendingEvents delivers unpublished events and marks them published upon success", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            const mockServer = {
                port: 3001,
                publish: mock(() => 1)
            };
            broadcaster.setServer(mockServer as any);

            const markedEvents: string[] = [];

            prisma.board_events = {
                ...prisma.board_events,
                findMany: mock((args: any) =>
                {
                    expect(args.where.published).toBe(false);
                    return Promise.resolve([
                        {
                            id: "pending-1",
                            boardId: validBoardId,
                            sequence: 1n,
                            eventType: "card:created",
                            payload: { cardId: "c1" },
                            published: false
                        },
                        {
                            id: "pending-2",
                            boardId: validBoardId,
                            sequence: 2n,
                            eventType: "card:moved",
                            payload: { cardId: "c1", position: 1000 },
                            published: false
                        }
                    ]);
                }),
                update: mock((args: any) =>
                {
                    markedEvents.push(args.where.id);
                    return Promise.resolve({ id: args.where.id, published: true });
                })
            } as any;

            const count = await broadcaster.retryPendingEvents(validBoardId);
            expect(count).toBe(2);
            expect(markedEvents).toEqual(["pending-1", "pending-2"]);
        });
    });

    describe("4. WebSockets Broadcaster Parity", () =>
    {
        it("verifies apps/websockets broadcaster has identical outbox behavior", async () =>
        {
            const wsBroadcasterInstance = new WsBroadcaster();
            let capturedData: any = null;

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 77n })),
                        create: mock((args: any) =>
                        {
                            capturedData = args.data;
                            return Promise.resolve({
                                id: "evt-ws-parity",
                                sequence: args.data.sequence
                            });
                        })
                    }
                };
                return fn(tx);
            }) as any;

            const rec = await wsBroadcasterInstance.recordBoardEvent("board_123", "card:updated", { cardId: "c1" });
            expect(rec).not.toBeNull();
            expect(rec?.sequence).toBe(78n);
            expect(capturedData.published).toBe(false);
            expect(capturedData.publishedAt).toBeNull();
        });
    });
});
