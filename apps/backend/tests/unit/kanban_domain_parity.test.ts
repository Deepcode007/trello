import { describe, expect, it, mock, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { getBoardEvents } from "../../src/controllers/board/getEvents";
import { createLabel, getLabels, attachLabel, detachLabel } from "../../src/controllers/labels/labelsController";
import { createChecklist, addChecklistItem, updateChecklistItem, deleteChecklist } from "../../src/controllers/checklists/checklistsController";
import { wsBroadcaster } from "../../src/services/broadcaster";

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
    afterEach(() => {
        wsBroadcaster.broadcast = origBroadcast;
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
    });

    describe("Checklists and Subtasks", () => {
        it("creates checklist on card and broadcasts checklist:created", async () => {
            const origIssueFind = prisma.issues.findUnique;
            const origChecklistCount = prisma.checklists.count;
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

            prisma.checklists.count = mock(() => Promise.resolve(0)) as any;
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
    });
});
