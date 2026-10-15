import { describe, expect, it, mock, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { getBoardEvents } from "../../src/controllers/board/getEvents";
import { createLabel, getLabels, attachLabel, detachLabel } from "../../src/controllers/labels/labelsController";
import { createChecklist, addChecklistItem, updateChecklistItem, deleteChecklist } from "../../src/controllers/checklists/checklistsController";
import { updateIssue } from "../../src/controllers/issues/updateIssue";
import { renameSection } from "../../src/controllers/sections/renameSection";
import { wsBroadcaster } from "../../src/services/broadcaster";
import { backfillPositions } from "../../../../packages/db/scripts/backfillPositions";

describe("Kanban Domain Parity & Event Sourcing Suite", () => {
    const validBoardId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const validOrgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const validIssueId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const validLabelId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const validChecklistId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const validItemId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const adminUserId = "admin-user-001";

    function createMockRes() {
        const res: any = {};
        res.statusCode = 200;
        res.body = null;
        res.status = mock((code: number) => {
            res.statusCode = code;
            return res;
        });
        res.json = mock((payload: any) => {
            res.body = payload;
            return res;
        });
        return res;
    }

    const origBroadcast = wsBroadcaster.broadcast;
    const origBroadcastCardMoved = wsBroadcaster.broadcastCardMoved;
    const origBroadcastCardUpdated = wsBroadcaster.broadcastCardUpdated;
    const origBroadcastListReordered = wsBroadcaster.broadcastListReordered;
    const origBroadcastCardCreated = wsBroadcaster.broadcastCardCreated;
    const origBroadcastCardDeleted = wsBroadcaster.broadcastCardDeleted;
    const origBroadcastUserJoined = wsBroadcaster.broadcastUserJoined;
    const origBroadcastUserLeft = wsBroadcaster.broadcastUserLeft;
    const origEvictUser = wsBroadcaster.evictUser;

    afterEach(() => {
        wsBroadcaster.broadcast = origBroadcast;
        wsBroadcaster.broadcastCardMoved = origBroadcastCardMoved;
        wsBroadcaster.broadcastCardUpdated = origBroadcastCardUpdated;
        wsBroadcaster.broadcastListReordered = origBroadcastListReordered;
        wsBroadcaster.broadcastCardCreated = origBroadcastCardCreated;
        wsBroadcaster.broadcastCardDeleted = origBroadcastCardDeleted;
        wsBroadcaster.broadcastUserJoined = origBroadcastUserJoined;
        wsBroadcaster.broadcastUserLeft = origBroadcastUserLeft;
        wsBroadcaster.evictUser = origEvictUser;
    });

    describe("Board Events Catch-up API", () => {
        it("returns board events with stringified sequence numbers", async () => {
            const origBoardFind = prisma.boards.findUnique;
            const origEventsFind = prisma.board_events.findMany;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId: adminUserId, accepted: true }]
                }
            })) as any;

            prisma.board_events.findMany = mock(() => Promise.resolve([
                {
                    id: "evt-1",
                    boardId: validBoardId,
                    sequence: 42n,
                    eventType: "card:moved",
                    payload: { cardId: "c1" },
                    published: true,
                    publishedAt: new Date(),
                    createdAt: new Date()
                }
            ])) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                query: { sinceSeq: "10" }
            };
            const res = createMockRes();

            await getBoardEvents(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].sequence).toBe("42");

            prisma.boards.findUnique = origBoardFind;
            prisma.board_events.findMany = origEventsFind;
        });

        it("records board events with monotonic sequence numbers", async () => {
            const origTransaction = prisma.$transaction;

            let currentSeq = 10n;
            let capturedData: any = null;
            let advisoryLockCalled = false;

            prisma.$transaction = mock(async (fn: any) => {
                const tx = {
                    $executeRaw: mock(() => {
                        advisoryLockCalled = true;
                        return Promise.resolve();
                    }),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: currentSeq })),
                        create: mock((args: any) => {
                            capturedData = args.data;
                            return Promise.resolve({
                                id: "new-evt-id",
                                sequence: args.data.sequence
                            });
                        })
                    }
                };
                return fn(tx);
            }) as any;

            const rec = await wsBroadcaster.recordBoardEvent(validBoardId, "card:created", { cardId: "c-1" });
            expect(rec).not.toBeNull();
            expect(rec?.sequence).toBe(11n);
            expect(advisoryLockCalled).toBe(true);
            expect(capturedData.sequence).toBe(11n);
            expect(capturedData.eventType).toBe("card:created");

            prisma.$transaction = origTransaction;
        });

        it("broadcasts event and attaches sequence number from recorded event", async () => {
            const origTransaction = prisma.$transaction;

            prisma.$transaction = mock(async (fn: any) => {
                const tx = {
                    $executeRaw: mock(() => Promise.resolve()),
                    board_events: {
                        findFirst: mock(() => Promise.resolve({ sequence: 5n })),
                        create: mock((args: any) => Promise.resolve({
                            id: "evt-uuid-5",
                            sequence: args.data.sequence
                        }))
                    }
                };
                return fn(tx);
            }) as any;

            let receivedEvent: any = null;
            const listener = (data: any) => { receivedEvent = data; };
            wsBroadcaster.on(`board:${validBoardId}`, listener);

            await wsBroadcaster.broadcast(validBoardId, {
                type: "card:moved",
                payload: { cardId: "c-1", position: 1000 }
            });

            expect(receivedEvent).not.toBeNull();
            expect(receivedEvent.sequence).toBe("6");
            expect(receivedEvent.eventId).toBe("evt-uuid-5");

            wsBroadcaster.off(`board:${validBoardId}`, listener);
            prisma.$transaction = origTransaction;
        });

        it("recordBoardEvent returns null when transaction fails", async () => {
            const origTransaction = prisma.$transaction;

            prisma.$transaction = mock(async () => {
                throw new Error("Advisory lock acquisition or transaction failure");
            }) as any;

            const rec = await wsBroadcaster.recordBoardEvent(validBoardId, "card:created", { cardId: "c-fail" });
            expect(rec).toBeNull();

            prisma.$transaction = origTransaction;
        });

        it("recordBoardEvent returns null immediately for invalid or empty boardId", async () => {
            expect(await wsBroadcaster.recordBoardEvent("", "card:created", {})).toBeNull();
            expect(await wsBroadcaster.recordBoardEvent("   ", "card:created", {})).toBeNull();
            expect(await wsBroadcaster.recordBoardEvent(null as any, "card:created", {})).toBeNull();
        });

        it("getBoardEvents rejects with Forbidden when user is not an accepted member", async () => {
            const origBoardFind = prisma.boards.findUnique;
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [] } // No accepted member matching req.id
            })) as any;

            const req: any = {
                id: "outsider-user",
                params: { boardId: validBoardId },
                query: {}
            };
            const res = createMockRes();

            await expect(getBoardEvents(req, res)).rejects.toThrow("Members only");
            prisma.boards.findUnique = origBoardFind;
        });

        it("getBoardEvents clamps limit query parameter to 500 max", async () => {
            const origBoardFind = prisma.boards.findUnique;
            const origEventsFind = prisma.board_events.findMany;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [{ userId: adminUserId, accepted: true }] }
            })) as any;

            let queryArgs: any = null;
            prisma.board_events.findMany = mock((args: any) => {
                queryArgs = args;
                return Promise.resolve([]);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                query: { limit: "2000" } // Greater than 500
            };
            const res = createMockRes();

            await getBoardEvents(req, res);
            expect(res.statusCode).toBe(200);
            expect(queryArgs.take).toBe(500);

            prisma.boards.findUnique = origBoardFind;
            prisma.board_events.findMany = origEventsFind;
        });

        it("getBoardEvents accepts req.params.id as fallback parameter", async () => {
            const origBoardFind = prisma.boards.findUnique;
            const origEventsFind = prisma.board_events.findMany;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [{ userId: adminUserId, accepted: true }] }
            })) as any;

            prisma.board_events.findMany = mock(() => Promise.resolve([])) as any;

            const req: any = {
                id: adminUserId,
                params: { id: validBoardId }, // Fallback from /api/boards/:id/events
                query: {}
            };
            const res = createMockRes();

            await getBoardEvents(req, res);
            expect(res.statusCode).toBe(200);

            prisma.boards.findUnique = origBoardFind;
            prisma.board_events.findMany = origEventsFind;
        });

        it("getBoardEvents throws Not_Found when board is not found", async () => {
            const origBoardFind = prisma.boards.findUnique;
            prisma.boards.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                query: {}
            };
            const res = createMockRes();

            await expect(getBoardEvents(req, res)).rejects.toThrow("Board not found");
            prisma.boards.findUnique = origBoardFind;
        });

        it("getBoardEvents throws ValidationError on invalid boardId UUID", async () => {
            const req: any = {
                id: adminUserId,
                params: { boardId: "not-a-uuid" },
                query: {}
            };
            const res = createMockRes();

            await expect(getBoardEvents(req, res)).rejects.toThrow();
        });

        it("getBoardEvents clamps limit < 1 to 1", async () => {
            const origBoardFind = prisma.boards.findUnique;
            const origEventsFind = prisma.board_events.findMany;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [{ userId: adminUserId, accepted: true }] }
            })) as any;

            let queryArgs: any = null;
            prisma.board_events.findMany = mock((args: any) => {
                queryArgs = args;
                return Promise.resolve([]);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                query: { limit: "-10" }
            };
            const res = createMockRes();

            await getBoardEvents(req, res);
            expect(res.statusCode).toBe(200);
            expect(queryArgs.take).toBe(1);

            prisma.boards.findUnique = origBoardFind;
            prisma.board_events.findMany = origEventsFind;
        });
    });

    describe("Labels Management", () => {
        it("creates label and broadcasts label:created", async () => {
            const origBoardFind = prisma.boards.findUnique;
            const origLabelCreate = prisma.labels.create;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId: adminUserId, accepted: true, role: "admin" }]
                }
            })) as any;

            prisma.labels.create = mock((args: any) => Promise.resolve({
                id: validLabelId,
                ...args.data
            })) as any;

            let broadcastCalled = false;
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastCalled = true;
                expect(evt.type).toBe("label:created");
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                body: { name: "Bug", color: "#e11d48" }
            };
            const res = createMockRes();

            await createLabel(req, res);

            expect(res.statusCode).toBe(201);
            expect(res.body.data.name).toBe("Bug");
            expect(broadcastCalled).toBe(true);

            prisma.boards.findUnique = origBoardFind;
            prisma.labels.create = origLabelCreate;
        });

        it("attaches label to card and broadcasts card:label_added", async () => {
            const origIssueFind = prisma.issues.findUnique;
            const origLabelFind = prisma.labels.findUnique;
            const origIssueLabelsUpsert = prisma.issue_labels.upsert;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: {
                    org: {
                        members: [{ userId: adminUserId, accepted: true, role: "admin" }]
                    }
                }
            })) as any;

            prisma.labels.findUnique = mock(() => Promise.resolve({
                id: validLabelId,
                boardId: validBoardId,
                name: "High Priority",
                color: "#f59e0b"
            })) as any;

            prisma.issue_labels.upsert = mock(() => Promise.resolve({
                id: "il-1",
                issueId: validIssueId,
                labelId: validLabelId
            })) as any;

            let broadcastType = "";
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { labelId: validLabelId }
            };
            const res = createMockRes();

            await attachLabel(req, res);

            expect(res.statusCode).toBe(201);
            expect(broadcastType).toBe("card:label_added");

            prisma.issues.findUnique = origIssueFind;
            prisma.labels.findUnique = origLabelFind;
            prisma.issue_labels.upsert = origIssueLabelsUpsert;
        });

        it("getLabels returns list of labels for authorized board member", async () => {
            const origBoardFind = prisma.boards.findUnique;
            const origLabelsFind = prisma.labels.findMany;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [{ userId: adminUserId, accepted: true }] }
            })) as any;

            prisma.labels.findMany = mock(() => Promise.resolve([
                { id: validLabelId, name: "Enhancement", color: "#10b981", boardId: validBoardId }
            ])) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId }
            };
            const res = createMockRes();

            await getLabels(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].name).toBe("Enhancement");

            prisma.boards.findUnique = origBoardFind;
            prisma.labels.findMany = origLabelsFind;
        });

        it("getLabels throws Forbidden if requester is not a member of board org", async () => {
            const origBoardFind = prisma.boards.findUnique;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [] }
            })) as any;

            const req: any = {
                id: "non-member",
                params: { boardId: validBoardId }
            };
            const res = createMockRes();

            await expect(getLabels(req, res)).rejects.toThrow("Members only");
            prisma.boards.findUnique = origBoardFind;
        });

        it("detachLabel removes label from card and broadcasts card:label_removed", async () => {
            const origIssueFind = prisma.issues.findUnique;
            const origDeleteMany = prisma.issue_labels.deleteMany;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                }
            })) as any;

            prisma.issue_labels.deleteMany = mock(() => Promise.resolve({ count: 1 })) as any;

            let broadcastType = "";
            let broadcastPayload: any = null;
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                broadcastPayload = evt.payload;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId, labelId: validLabelId }
            };
            const res = createMockRes();

            await detachLabel(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(broadcastType).toBe("card:label_removed");
            expect(broadcastPayload.issueId).toBe(validIssueId);
            expect(broadcastPayload.labelId).toBe(validLabelId);

            prisma.issues.findUnique = origIssueFind;
            prisma.issue_labels.deleteMany = origDeleteMany;
        });

        it("createLabel throws Forbidden when requester is not admin or employee", async () => {
            const origBoardFind = prisma.boards.findUnique;
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { members: [] }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { boardId: validBoardId },
                body: { name: "Feature", color: "#3b82f6" }
            };
            const res = createMockRes();

            await expect(createLabel(req, res)).rejects.toThrow("Admin/Employee access required");
            prisma.boards.findUnique = origBoardFind;
        });

        it("createLabel throws Not_Found when board does not exist", async () => {
            const origBoardFind = prisma.boards.findUnique;
            prisma.boards.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                body: { name: "Feature", color: "#3b82f6" }
            };
            const res = createMockRes();

            await expect(createLabel(req, res)).rejects.toThrow("Board not found");
            prisma.boards.findUnique = origBoardFind;
        });

        it("createLabel throws ValidationError on empty name or color", async () => {
            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                body: { name: "   ", color: "" }
            };
            const res = createMockRes();

            await expect(createLabel(req, res)).rejects.toThrow();
        });

        it("attachLabel throws Not_Found when card/issue does not exist", async () => {
            const origIssueFind = prisma.issues.findUnique;
            prisma.issues.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { labelId: validLabelId }
            };
            const res = createMockRes();

            await expect(attachLabel(req, res)).rejects.toThrow("Issue not found");
            prisma.issues.findUnique = origIssueFind;
        });

        it("attachLabel throws Forbidden when user is not admin or employee", async () => {
            const origIssueFind = prisma.issues.findUnique;
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: { org: { members: [] } }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { issueId: validIssueId },
                body: { labelId: validLabelId }
            };
            const res = createMockRes();

            await expect(attachLabel(req, res)).rejects.toThrow("Admin/Employee access required");
            prisma.issues.findUnique = origIssueFind;
        });

        it("attachLabel throws ValidationError when label belongs to a different board", async () => {
            const origIssueFind = prisma.issues.findUnique;
            const origLabelFind = prisma.labels.findUnique;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                }
            })) as any;

            // Label belongs to a different board!
            prisma.labels.findUnique = mock(() => Promise.resolve({
                id: validLabelId,
                boardId: "99999999-9999-4999-8999-999999999999",
                name: "Cross Label",
                color: "#123456"
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { labelId: validLabelId }
            };
            const res = createMockRes();

            await expect(attachLabel(req, res)).rejects.toThrow("Label does not belong to this board");

            prisma.issues.findUnique = origIssueFind;
            prisma.labels.findUnique = origLabelFind;
        });

        it("detachLabel throws Not_Found when issue is not found", async () => {
            const origIssueFind = prisma.issues.findUnique;
            prisma.issues.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId, labelId: validLabelId }
            };
            const res = createMockRes();

            await expect(detachLabel(req, res)).rejects.toThrow("Issue not found");
            prisma.issues.findUnique = origIssueFind;
        });

        it("detachLabel throws Forbidden when user is not admin or employee", async () => {
            const origIssueFind = prisma.issues.findUnique;
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: { org: { members: [] } }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { issueId: validIssueId, labelId: validLabelId }
            };
            const res = createMockRes();

            await expect(detachLabel(req, res)).rejects.toThrow("Admin/Employee access required");
            prisma.issues.findUnique = origIssueFind;
        });
    });

    describe("Checklists and Subtasks", () => {
        it("creates checklist on card and broadcasts checklist:created", async () => {
            const origIssueFind = prisma.issues.findUnique;
            const origChecklistCount = prisma.checklists.count;
            const origChecklistFindFirst = prisma.checklists.findFirst;
            const origChecklistCreate = prisma.checklists.create;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: {
                    org: {
                        members: [{ userId: adminUserId, accepted: true, role: "employee" }]
                    }
                }
            })) as any;

            prisma.checklists.findFirst = mock(() => Promise.resolve(null)) as any;
            prisma.checklists.create = mock((args: any) => Promise.resolve({
                id: validChecklistId,
                title: args.data.title,
                position: args.data.position,
                issueId: validIssueId,
                items: []
            })) as any;

            let broadcastType = "";
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { title: "Definition of Done" }
            };
            const res = createMockRes();

            await createChecklist(req, res);

            expect(res.statusCode).toBe(201);
            expect(res.body.data.title).toBe("Definition of Done");
            expect(broadcastType).toBe("checklist:created");

            prisma.issues.findUnique = origIssueFind;
            prisma.checklists.count = origChecklistCount;
            prisma.checklists.findFirst = origChecklistFindFirst;
            prisma.checklists.create = origChecklistCreate;
        });

        it("createChecklist calculates position based on highest existing checklist position rather than count to prevent collisions", async () => {
            const origIssueFind = prisma.issues.findUnique;
            const origChecklistFindFirst = prisma.checklists.findFirst;
            const origChecklistCreate = prisma.checklists.create;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: {
                    org: {
                        members: [{ userId: adminUserId, accepted: true, role: "employee" }]
                    }
                }
            })) as any;

            // Scenario: 3 checklists existed (1000, 2000, 3000), checklist 2 deleted.
            // Remaining highest position is 3000.
            prisma.checklists.findFirst = mock((args: any) => {
                expect(args.where).toEqual({ issueId: validIssueId });
                expect(args.orderBy).toEqual({ position: "desc" });
                return Promise.resolve({ position: 3000 });
            }) as any;

            let createdPosition = 0;
            prisma.checklists.create = mock((args: any) => {
                createdPosition = args.data.position;
                return Promise.resolve({
                    id: validChecklistId,
                    title: args.data.title,
                    position: args.data.position,
                    issueId: validIssueId,
                    items: []
                });
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { title: "Definition of Done" }
            };
            const res = createMockRes();

            await createChecklist(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdPosition).toBe(4000); // 3000 + 1000, avoiding collision with existing checklist at 3000

            prisma.issues.findUnique = origIssueFind;
            prisma.checklists.findFirst = origChecklistFindFirst;
            prisma.checklists.create = origChecklistCreate;
        });

        it("updates checklist item completion and broadcasts checklist_item:updated", async () => {
            const origItemFind = prisma.checklist_items.findUnique;
            const origItemUpdate = prisma.checklist_items.update;

            prisma.checklist_items.findUnique = mock(() => Promise.resolve({
                id: validItemId,
                checklistId: validChecklistId,
                checklist: {
                    issue: {
                        boardId: validBoardId,
                        board: {
                            org: {
                                members: [{ userId: adminUserId, accepted: true, role: "admin" }]
                            }
                        }
                    }
                }
            })) as any;

            prisma.checklist_items.update = mock(() => Promise.resolve({
                id: validItemId,
                content: "Write tests",
                isCompleted: true
            })) as any;

            let broadcastType = "";
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { itemId: validItemId },
                body: { isCompleted: true }
            };
            const res = createMockRes();

            await updateChecklistItem(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.isCompleted).toBe(true);
            expect(broadcastType).toBe("checklist_item:updated");

            prisma.checklist_items.findUnique = origItemFind;
            prisma.checklist_items.update = origItemUpdate;
        });

        it("addChecklistItem calculates position based on highest position and broadcasts checklist_item:created", async () => {
            const origChecklistFind = prisma.checklists.findUnique;
            const origItemCount = prisma.checklist_items.count;
            const origItemFindFirst = prisma.checklist_items.findFirst;
            const origItemCreate = prisma.checklist_items.create;

            prisma.checklists.findUnique = mock(() => Promise.resolve({
                id: validChecklistId,
                issueId: validIssueId,
                issue: {
                    boardId: validBoardId,
                    board: {
                        org: { members: [{ userId: adminUserId, accepted: true, role: "employee" }] }
                    }
                }
            })) as any;

            prisma.checklist_items.findFirst = mock(() => Promise.resolve({ position: 2000 })) as any;
            let createdPosition = 0;
            prisma.checklist_items.create = mock((args: any) => {
                createdPosition = args.data.position;
                return Promise.resolve({
                    id: validItemId,
                    content: args.data.content,
                    position: args.data.position
                });
            }) as any;

            let broadcastType = "";
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { checklistId: validChecklistId },
                body: { content: "Second subtask" }
            };
            const res = createMockRes();

            await addChecklistItem(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdPosition).toBe(3000); // 2000 + 1000
            expect(broadcastType).toBe("checklist_item:created");

            prisma.checklists.findUnique = origChecklistFind;
            prisma.checklist_items.count = origItemCount;
            prisma.checklist_items.findFirst = origItemFindFirst;
            prisma.checklist_items.create = origItemCreate;
        });

        it("deleteChecklist deletes checklist and broadcasts checklist:deleted", async () => {
            const origChecklistFind = prisma.checklists.findUnique;
            const origChecklistDelete = prisma.checklists.delete;

            prisma.checklists.findUnique = mock(() => Promise.resolve({
                id: validChecklistId,
                issueId: validIssueId,
                issue: {
                    boardId: validBoardId,
                    board: {
                        org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                    }
                }
            })) as any;

            prisma.checklists.delete = mock(() => Promise.resolve({})) as any;

            let broadcastType = "";
            let broadcastPayload: any = null;
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                broadcastPayload = evt.payload;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { checklistId: validChecklistId }
            };
            const res = createMockRes();

            await deleteChecklist(req, res);

            expect(res.statusCode).toBe(200);
            expect(broadcastType).toBe("checklist:deleted");
            expect(broadcastPayload.checklistId).toBe(validChecklistId);
            expect(broadcastPayload.issueId).toBe(validIssueId);

            prisma.checklists.findUnique = origChecklistFind;
            prisma.checklists.delete = origChecklistDelete;
        });

        it("createChecklist throws Forbidden if requester is not admin or employee", async () => {
            const origIssueFind = prisma.issues.findUnique;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                board: {
                    org: {
                        members: [] // No admin or employee role match
                    }
                }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { issueId: validIssueId },
                body: { title: "New Checklist" }
            };
            const res = createMockRes();

            await expect(createChecklist(req, res)).rejects.toThrow("Admin/Employee access required");
            prisma.issues.findUnique = origIssueFind;
        });

        it("createChecklist throws Not_Found when card/issue does not exist", async () => {
            const origIssueFind = prisma.issues.findUnique;
            prisma.issues.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { title: "Card Check" }
            };
            const res = createMockRes();

            await expect(createChecklist(req, res)).rejects.toThrow("Card not found");
            prisma.issues.findUnique = origIssueFind;
        });

        it("createChecklist throws ValidationError on empty title", async () => {
            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { title: "   " }
            };
            const res = createMockRes();

            await expect(createChecklist(req, res)).rejects.toThrow();
        });

        it("addChecklistItem throws Not_Found when checklist does not exist", async () => {
            const origChecklistFind = prisma.checklists.findUnique;
            prisma.checklists.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { checklistId: validChecklistId },
                body: { content: "Subtask 1" }
            };
            const res = createMockRes();

            await expect(addChecklistItem(req, res)).rejects.toThrow("Checklist not found");
            prisma.checklists.findUnique = origChecklistFind;
        });

        it("addChecklistItem throws Forbidden when user is not admin or employee", async () => {
            const origChecklistFind = prisma.checklists.findUnique;
            prisma.checklists.findUnique = mock(() => Promise.resolve({
                id: validChecklistId,
                issueId: validIssueId,
                issue: {
                    boardId: validBoardId,
                    board: { org: { members: [] } }
                }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { checklistId: validChecklistId },
                body: { content: "Subtask 1" }
            };
            const res = createMockRes();

            await expect(addChecklistItem(req, res)).rejects.toThrow("Admin/Employee access required");
            prisma.checklists.findUnique = origChecklistFind;
        });

        it("addChecklistItem sets optional dueDate properly", async () => {
            const origChecklistFind = prisma.checklists.findUnique;
            const origItemCount = prisma.checklist_items.count;
            const origItemFindFirst = prisma.checklist_items.findFirst;
            const origItemCreate = prisma.checklist_items.create;

            prisma.checklists.findUnique = mock(() => Promise.resolve({
                id: validChecklistId,
                issueId: validIssueId,
                issue: {
                    boardId: validBoardId,
                    board: { org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] } }
                }
            })) as any;

            prisma.checklist_items.findFirst = mock(() => Promise.resolve(null)) as any;
            let createdData: any = null;
            prisma.checklist_items.create = mock((args: any) => {
                createdData = args.data;
                return Promise.resolve({ id: validItemId, ...args.data });
            }) as any;

            const isoDate = "2026-12-31T23:59:59.000Z";
            const req: any = {
                id: adminUserId,
                params: { checklistId: validChecklistId },
                body: { content: "Dated item", dueDate: isoDate }
            };
            const res = createMockRes();

            await addChecklistItem(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.dueDate).toBeInstanceOf(Date);
            expect(createdData.dueDate.toISOString()).toBe(isoDate);

            prisma.checklists.findUnique = origChecklistFind;
            prisma.checklist_items.count = origItemCount;
            prisma.checklist_items.findFirst = origItemFindFirst;
            prisma.checklist_items.create = origItemCreate;
        });

        it("updateChecklistItem throws Not_Found when item does not exist", async () => {
            const origItemFind = prisma.checklist_items.findUnique;
            prisma.checklist_items.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { itemId: validItemId },
                body: { isCompleted: true }
            };
            const res = createMockRes();

            await expect(updateChecklistItem(req, res)).rejects.toThrow("Checklist item not found");
            prisma.checklist_items.findUnique = origItemFind;
        });

        it("updateChecklistItem throws Forbidden when requester lacks admin/employee role", async () => {
            const origItemFind = prisma.checklist_items.findUnique;
            prisma.checklist_items.findUnique = mock(() => Promise.resolve({
                id: validItemId,
                checklistId: validChecklistId,
                checklist: {
                    issue: {
                        boardId: validBoardId,
                        board: { org: { members: [] } }
                    }
                }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { itemId: validItemId },
                body: { isCompleted: true }
            };
            const res = createMockRes();

            await expect(updateChecklistItem(req, res)).rejects.toThrow("Admin/Employee access required");
            prisma.checklist_items.findUnique = origItemFind;
        });

        it("updateChecklistItem nulls out dueDate and updates content", async () => {
            const origItemFind = prisma.checklist_items.findUnique;
            const origItemUpdate = prisma.checklist_items.update;

            prisma.checklist_items.findUnique = mock(() => Promise.resolve({
                id: validItemId,
                checklistId: validChecklistId,
                checklist: {
                    issue: {
                        boardId: validBoardId,
                        board: { org: { members: [{ userId: adminUserId, accepted: true, role: "employee" }] } }
                    }
                }
            })) as any;

            let updatePayload: any = null;
            prisma.checklist_items.update = mock((args: any) => {
                updatePayload = args.data;
                return Promise.resolve({ id: validItemId, ...args.data });
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { itemId: validItemId },
                body: { content: "Updated content", dueDate: null }
            };
            const res = createMockRes();

            await updateChecklistItem(req, res);
            expect(res.statusCode).toBe(200);
            expect(updatePayload.content).toBe("Updated content");
            expect(updatePayload.dueDate).toBeNull();

            prisma.checklist_items.findUnique = origItemFind;
            prisma.checklist_items.update = origItemUpdate;
        });

        it("deleteChecklist throws Not_Found when checklist does not exist", async () => {
            const origChecklistFind = prisma.checklists.findUnique;
            prisma.checklists.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { checklistId: validChecklistId }
            };
            const res = createMockRes();

            await expect(deleteChecklist(req, res)).rejects.toThrow("Checklist not found");
            prisma.checklists.findUnique = origChecklistFind;
        });
    });

    describe("Rich Card Attributes & Movement (updateIssue)", () => {
        const origIssueFindUnique = prisma.issues.findUnique;
        const origSectionFindUnique = prisma.sections.findUnique;
        const origIssueUpdate = prisma.issues.update;

        afterEach(() => {
            prisma.issues.findUnique = origIssueFindUnique;
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.issues.update = origIssueUpdate;
        });

        it("updates rich card fields (priority, dueDate, startDate, description, isArchived) and broadcasts card:updated", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: "sec-src-1",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                }
            })) as any;

            let capturedUpdateData: any = null;
            prisma.issues.update = mock((args: any) => {
                capturedUpdateData = args.data;
                return Promise.resolve({ id: validIssueId, ...args.data });
            }) as any;

            let broadcastType = "";
            let broadcastUpdates: any = null;
            wsBroadcaster.broadcastCardUpdated = mock((_bId: string, _cId: string, updates: any) => {
                broadcastType = "card:updated";
                broadcastUpdates = updates;
                return Promise.resolve(true);
            }) as any;

            const dueDateIso = "2026-11-20T10:00:00.000Z";
            const startDateIso = "2026-11-15T09:00:00.000Z";

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: {
                    priority: "urgent",
                    dueDate: dueDateIso,
                    startDate: startDateIso,
                    description: "High priority mission card",
                    isArchived: true
                }
            };
            const res = createMockRes();

            await updateIssue(req, res);

            expect(res.statusCode).toBe(200);
            expect(capturedUpdateData.priority).toBe("urgent");
            expect(capturedUpdateData.dueDate).toBeInstanceOf(Date);
            expect(capturedUpdateData.startDate).toBeInstanceOf(Date);
            expect(capturedUpdateData.description).toBe("High priority mission card");
            expect(capturedUpdateData.isArchived).toBe(true);
            expect(broadcastType).toBe("card:updated");
            expect(broadcastUpdates.priority).toBe("urgent");
            expect(broadcastUpdates.isArchived).toBe(true);
        });

        it("nulls out dueDate and startDate when passed null", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: "sec-src-1",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "employee" }] }
                }
            })) as any;

            let capturedUpdateData: any = null;
            prisma.issues.update = mock((args: any) => {
                capturedUpdateData = args.data;
                return Promise.resolve({ id: validIssueId, ...args.data });
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: {
                    dueDate: null,
                    startDate: null
                }
            };
            const res = createMockRes();

            await updateIssue(req, res);

            expect(res.statusCode).toBe(200);
            expect(capturedUpdateData.dueDate).toBeNull();
            expect(capturedUpdateData.startDate).toBeNull();
        });

        it("throws ValidationError when moving card to a section on a different board", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: "sec-src-1",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                }
            })) as any;

            // Target section belongs to a different board!
            const otherBoardSectionId = "88888888-8888-4888-8888-888888888888";
            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: otherBoardSectionId,
                boardId: "99999999-9999-4999-8999-999999999999"
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { sectionId: otherBoardSectionId }
            };
            const res = createMockRes();

            await expect(updateIssue(req, res)).rejects.toThrow("Section belongs to a different board");
        });

        it("throws Not_Found when target section for move does not exist", async () => {
            const ghostSectionId = "77777777-7777-4777-8777-777777777777";
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: "sec-src-1",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { sectionId: ghostSectionId }
            };
            const res = createMockRes();

            await expect(updateIssue(req, res)).rejects.toThrow("Section not found");
        });

        it("throws Not_Found when card/issue does not exist", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { title: "Renamed" }
            };
            const res = createMockRes();

            await expect(updateIssue(req, res)).rejects.toThrow("Issue not found");
        });

        it("throws Forbidden when user lacks admin/employee role", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: "sec-1",
                board: {
                    org: { members: [] } // No admin or employee
                }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { issueId: validIssueId },
                body: { title: "Renamed" }
            };
            const res = createMockRes();

            await expect(updateIssue(req, res)).rejects.toThrow("Admin/Employee access only");
        });

        it("moves card using destList alias parameter", async () => {
            const destSecId = "44444444-4444-4444-8444-444444444444";
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: "sec-src-1",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "employee" }] }
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: destSecId,
                boardId: validBoardId
            })) as any;

            let updatedSectionId = "";
            prisma.issues.update = mock((args: any) => {
                updatedSectionId = args.data.sectionId;
                return Promise.resolve({ id: validIssueId, ...args.data });
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { cardId: validIssueId }, // using cardId param alias
                body: { destList: destSecId }
            };
            const res = createMockRes();

            await updateIssue(req, res);
            expect(res.statusCode).toBe(200);
            expect(updatedSectionId).toBe(destSecId);
        });
    });

    describe("Section Management Parity (renameSection)", () => {
        const origSectionFindUnique = prisma.sections.findUnique;
        const origSectionUpdate = prisma.sections.update;

        afterEach(() => {
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.sections.update = origSectionUpdate;
        });

        it("updates wipLimit and isArchived and broadcasts list:updated", async () => {
            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: "sec-123",
                boardId: validBoardId,
                title: "In Progress",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "admin" }] }
                }
            })) as any;

            let updatePayload: any = null;
            prisma.sections.update = mock((args: any) => {
                updatePayload = args.data;
                return Promise.resolve({ id: "sec-123", boardId: validBoardId, title: "In Progress", ...args.data });
            }) as any;

            let broadcastType = "";
            let broadcastEventPayload: any = null;
            wsBroadcaster.broadcast = mock((_bId: string, evt: any) => {
                broadcastType = evt.type;
                broadcastEventPayload = evt.payload;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { sectionId: "11111111-2222-4333-8444-555555555555" },
                body: { wipLimit: 5, isArchived: false }
            };
            const res = createMockRes();

            await renameSection(req, res);

            expect(res.statusCode).toBe(200);
            expect(updatePayload.wipLimit).toBe(5);
            expect(updatePayload.isArchived).toBe(false);
            expect(broadcastType).toBe("list:updated");
            expect(broadcastEventPayload.wipLimit).toBe(5);
        });

        it("updates position using newPosition alias and broadcasts list:reordered", async () => {
            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: "sec-reorder",
                boardId: validBoardId,
                title: "To Do",
                board: {
                    org: { members: [{ userId: adminUserId, accepted: true, role: "employee" }] }
                }
            })) as any;

            let updatePayload: any = null;
            prisma.sections.update = mock((args: any) => {
                updatePayload = args.data;
                return Promise.resolve({ id: "sec-reorder", boardId: validBoardId, ...args.data });
            }) as any;

            let reorderedPayload: any = null;
            wsBroadcaster.broadcastListReordered = mock((boardId: string, listId: string, pos: number) => {
                reorderedPayload = { boardId, listId, pos };
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: adminUserId,
                params: { sectionId: "11111111-2222-4333-8444-555555555555" },
                body: { newPosition: 4000 }
            };
            const res = createMockRes();

            await renameSection(req, res);

            expect(res.statusCode).toBe(200);
            expect(updatePayload.position).toBe(4000);
            expect(reorderedPayload).not.toBeNull();
            expect(reorderedPayload.listId).toBe("sec-reorder");
            expect(reorderedPayload.pos).toBe(4000);
        });

        it("throws ValidationError when no update fields are provided", async () => {
            const req: any = {
                id: adminUserId,
                params: { sectionId: "11111111-2222-4333-8444-555555555555" },
                body: {}
            };
            const res = createMockRes();

            await expect(renameSection(req, res)).rejects.toThrow();
        });

        it("throws Not_Found when section does not exist", async () => {
            prisma.sections.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: adminUserId,
                params: { sectionId: "11111111-2222-4333-8444-555555555555" },
                body: { title: "New Name" }
            };
            const res = createMockRes();

            await expect(renameSection(req, res)).rejects.toThrow("Invalid sectionId/Section Not found");
        });

        it("throws Forbidden when user is not admin or employee", async () => {
            prisma.sections.findUnique = mock(() => Promise.resolve({
                title: "Sec",
                board: { org: { members: [] } }
            })) as any;

            const req: any = {
                id: "viewer-user",
                params: { sectionId: "11111111-2222-4333-8444-555555555555" },
                body: { title: "New Name" }
            };
            const res = createMockRes();

            await expect(renameSection(req, res)).rejects.toThrow("Admin/Employee access required");
        });
    });

    describe("Backfill Positions Script", () => {
        it("backfillPositions executes raw SQL migrations and returns success true", async () => {
            const origExecuteRaw = prisma.$executeRawUnsafe;
            let executionCalls: string[] = [];

            prisma.$executeRawUnsafe = mock((query: string) => {
                executionCalls.push(query);
                return Promise.resolve(1);
            }) as any;

            const result = await backfillPositions();
            expect(result.success).toBe(true);
            expect(executionCalls.length).toBe(2);
            expect(executionCalls[0]).toContain("ranked_sections");
            expect(executionCalls[1]).toContain("ranked_issues");

            prisma.$executeRawUnsafe = origExecuteRaw;
        });

        it("backfillPositions returns success false with error message when query fails", async () => {
            const origExecuteRaw = prisma.$executeRawUnsafe;

            prisma.$executeRawUnsafe = mock(() => {
                return Promise.reject(new Error("Database connection dropped"));
            }) as any;

            const result = await backfillPositions();
            expect(result.success).toBe(false);
            expect(result.error).toContain("Database connection dropped");

            prisma.$executeRawUnsafe = origExecuteRaw;
        });
    });
});
