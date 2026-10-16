import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { WebSocketBroadcaster as BackendBroadcaster, wsBroadcaster } from "../../src/services/broadcaster";

describe("Transactional Outbox Pattern & Monotonic Event Stream Suite", () =>
{
    const validBoardId = "44444444-4444-4444-8444-444444444444";
    const origTransaction = prisma.$transaction;
    const origBoardEvents = prisma.board_events;
    const origFetch = globalThis.fetch;
    let transportRequests: RequestInit[] = [];

    function mockSuccessfulWsTransport()
    {
        transportRequests = [];
        globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) =>
        {
            transportRequests.push(init ?? {});
            return new Response(null, { status: 200 });
        }) as unknown as typeof fetch;
        return transportRequests;
    }

    afterEach(() =>
    {
        prisma.$transaction = origTransaction;
        (prisma as any).board_events = origBoardEvents;
        globalThis.fetch = origFetch;
    });

    describe("1. Transactional Tying of Mutations to Event Outbox", () =>
    {
        it("records event in the caller's transaction when tx is provided", async () =>
        {
            let advisoryLockCalled = false;
            let capturedData: any = null;

            const mockTx = {
                $queryRaw: mock(() =>
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
                $queryRaw: mock(() => Promise.resolve()),
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
            let claimed = false;

            const broadcaster = new BackendBroadcaster();
            const requests = mockSuccessfulWsTransport();

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $queryRaw: mock((strings: TemplateStringsArray) =>
                    {
                        if (strings.join(" ").includes("pg_advisory_xact_lock") || claimed) return Promise.resolve([]);
                        claimed = true;
                        return Promise.resolve([{
                            id: "evt-atom-1",
                            boardId: validBoardId,
                            sequence: 51n,
                            eventType: "card:moved",
                            payload: { cardId: "c-tx", position: 500 }
                        }]);
                    }),
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

            (prisma as any).board_events = {
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
            expect(requests).toHaveLength(1);
            expect(res.published).toBe(true);
            expect(String(requests[0]?.body)).toContain('"eventId":"evt-atom-1"');
            expect(String(requests[0]?.body)).toContain('"sequence":"51"');
        });

        it("executeWithOutbox rolls back transaction if mutation fails", async () =>
        {
            const broadcaster = new BackendBroadcaster();

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $queryRaw: mock(() => Promise.resolve()),
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

        it("does not commit a mutation when writing its outbox event fails", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            let transactionCommitted = false;
            let mutationRan = false;
            prisma.$transaction = mock(async (fn: any) =>
            {
                try
                {
                    const result = await fn({
                        $queryRaw: mock(() => Promise.resolve([])),
                        board_events: {
                            findFirst: mock(() => Promise.resolve(null)),
                            create: mock(() => { throw new Error("outbox write failed"); })
                        }
                    });
                    transactionCommitted = true;
                    return result;
                } catch (error)
                {
                    throw error;
                }
            }) as any;

            await expect(broadcaster.executeWithOutbox(
                validBoardId,
                { type: "card:created", payload: {} },
                async () => { mutationRan = true; return "created"; }
            )).rejects.toThrow("outbox write failed");
            expect(mutationRan).toBe(true);
            expect(transactionCommitted).toBe(false);
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
                    $queryRaw: mock(() => Promise.resolve()),
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

        it("marks a pre-recorded event published only after transport succeeds", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            let markPublishedCalled = false;
            let markedEventId = "";

            mockSuccessfulWsTransport();

            (prisma as any).board_events = {
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
            }, { eventId: "evt-pub-mark", sequence: 13n, skipRecording: true });

            expect(success).toBe(true);
            expect(markPublishedCalled).toBe(true);
            expect(markedEventId).toBe("evt-pub-mark");
        });

        it("leaves event unpublished (published: false) when transport fails", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            // HTTP endpoint is offline
            broadcaster.setPort(9999); // nonexistent port

            let updateCalled = false;

            (prisma as any).board_events = {
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
            }, { eventId: "evt-failed-transport", sequence: 16n, skipRecording: true });

            expect(success).toBe(false);
            expect(updateCalled).toBe(false); // Did not mark published!
        });
    });

    describe("3. Retrying Pending Outbox Events", () =>
    {
        it("retryPendingEvents delivers unpublished events and marks them published upon success", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            const requests = mockSuccessfulWsTransport();

            const markedEvents: string[] = [];
            let alreadyClaimed = false;

            (prisma as any).board_events = {
                ...prisma.board_events,
                update: mock((args: any) =>
                {
                    markedEvents.push(args.where.id);
                    return Promise.resolve({ id: args.where.id, published: true });
                }),
                updateMany: mock(() => Promise.resolve({ count: 1 }))
            } as any;

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $queryRaw: mock((strings: TemplateStringsArray) =>
                    {
                        if (strings.join(" ").includes("pg_advisory_xact_lock") || alreadyClaimed) return Promise.resolve([]);
                        alreadyClaimed = true;
                        return Promise.resolve([
                            {
                                id: "pending-1",
                                boardId: validBoardId,
                                sequence: 1n,
                                eventType: "card:created",
                                payload: { cardId: "c1" },
                                published: false
                            }
                        ]);
                    })
                };
                return fn(tx);
            }) as any;

            const count = await broadcaster.retryPendingEvents(validBoardId);
            expect(count).toBe(1);
            expect(markedEvents).toEqual(["pending-1"]);
            expect(String(requests[0]?.body)).toContain('"eventId":"pending-1"');
            expect(String(requests[0]?.body)).toContain('"sequence":"1"');
        });

        it("supports resolver events and persists all of them in the mutation transaction", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            const requests = mockSuccessfulWsTransport();
            const creates: any[] = [];
            const pending: any[] = [];
            const publishedIds = new Set<string>();
            (prisma as any).board_events = {
                ...prisma.board_events,
                update: mock((args: any) =>
                {
                    publishedIds.add(args.where.id);
                    return Promise.resolve({ id: args.where.id, published: true });
                }),
                updateMany: mock(() => Promise.resolve({ count: 0 }))
            } as any;
            let sequence = 0n;

            prisma.$transaction = mock(async (fn: any) =>
            {
                const tx = {
                    $queryRaw: mock((strings: TemplateStringsArray) =>
                    {
                        if (strings.join(" ").includes("pg_advisory_xact_lock")) return Promise.resolve([]);
                        return Promise.resolve(pending.filter(evt => !publishedIds.has(evt.id)).slice(0, 1));
                    }),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence })),
                        create: mock((args: any) =>
                        {
                            creates.push(args.data);
                            sequence = args.data.sequence;
                            const record = {
                                id: `evt-${sequence}`,
                                boardId: validBoardId,
                                sequence,
                                eventType: args.data.eventType,
                                payload: args.data.payload
                            };
                            pending.push(record);
                            return Promise.resolve({ id: record.id, sequence });
                        })
                    }
                };
                return fn(tx);
            }) as any;

            const result = await broadcaster.executeWithOutbox(validBoardId, created => [
                { type: "card:moved", payload: { cardId: created.id } },
                { type: "card:updated", payload: { cardId: created.id, updates: { title: "x" } } }
            ], async () => ({ id: "card-x" }));

            expect(result.events).toHaveLength(2);
            expect(creates.map(row => row.sequence)).toEqual([1n, 2n]);
            expect(creates.every(row => row.published === false)).toBe(true);
            expect(requests).toHaveLength(2);
        });

        it("allows a resolver to return no events without inserting outbox rows", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            let createCalled = false;
            prisma.$transaction = mock(async (fn: any) => fn({
                $queryRaw: mock(() => Promise.resolve()),
                board_events: {
                    findFirst: mock(() => Promise.resolve(null)),
                    create: mock(() => { createCalled = true; return Promise.resolve({}); })
                }
            })) as any;
            const result = await broadcaster.executeWithOutbox(validBoardId, () => null, async () => "ok");
            expect(result.result).toBe("ok");
            expect(result.events).toHaveLength(0);
            expect(createCalled).toBe(false);
        });

        it("keeps raw transport broadcasts from writing a second outbox row", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            mockSuccessfulWsTransport();
            const transaction = prisma.$transaction;
            const transactionCalled = mock(() => undefined);
            prisma.$transaction = transactionCalled as any;
            await broadcaster.broadcast(validBoardId, { type: "ephemeral:event", payload: {} });
            expect(transactionCalled).not.toHaveBeenCalled();
            prisma.$transaction = transaction;
        });

        it("starts with a drain and stops its interval without creating a WebSocket-side worker", async () =>
        {
            const broadcaster = new BackendBroadcaster();
            const queryCalls: string[] = [];
            (prisma as any).board_events = {
                ...prisma.board_events,
                updateMany: mock(() => Promise.resolve({ count: 0 }))
            } as any;
            prisma.$transaction = mock(async (fn: any) => fn({
                $queryRaw: mock((strings: TemplateStringsArray) =>
                {
                    queryCalls.push(strings.join(" "));
                    return Promise.resolve([]);
                })
            })) as any;
            broadcaster.startOutboxWorker(60_000);
            await broadcaster.stopOutboxWorker();
            expect(queryCalls.join(" ")).toContain("FOR UPDATE SKIP LOCKED");
            expect(queryCalls.join(" ")).toContain("NOT EXISTS");
        });
    });
});
