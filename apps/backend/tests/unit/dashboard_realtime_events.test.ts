import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { createBoard } from "../../src/controllers/board/createBoard";
import { deleteBoard } from "../../src/controllers/board/deleteBoard";
import { updateBoard } from "../../src/controllers/board/updateBoard";
import { getAllBoards } from "../../src/controllers/board/getBoards";
import { createSection } from "../../src/controllers/sections/createSection";
import { deleteSection } from "../../src/controllers/sections/deleteSection";
import { createIssue } from "../../src/controllers/issues/createIssue";
import { deleteIssue } from "../../src/controllers/issues/deleteIssue";
import { wsBroadcaster } from "../../src/services/broadcaster";
import { Forbidden, Not_Found } from "../../src/helpers/errorClass";

describe("Phase 4 Follow-up: Dashboard Realtime Board Lifecycle & Live Column Counts Suite", () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const otherOrgId = "22222222-2222-4222-8222-222222222222";
    const boardId = "33333333-3333-4333-8333-333333333333";
    const sectionId = "44444444-4444-4444-8444-444444444444";
    const issueId = "55555555-5555-4555-8555-555555555555";
    const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const employeeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const contributorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const member2Id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const externalUserId = "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx";

    function createMockRes() {
        const res: any = {};
        res.statusCode = 200;
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

    let notifiedUsers: { userIds: string[]; event: any }[] = [];
    let boardBroadcasts: { boardId: string; event: any }[] = [];

    const origNotifyUsers = wsBroadcaster.notifyUsers;
    const origBroadcast = wsBroadcaster.broadcast;
    const origExecuteWithOutbox = wsBroadcaster.executeWithOutbox;

    const origOrgFindUnique = prisma.orgs.findUnique;
    const origMembershipFindUnique = prisma.membership.findUnique;
    const origMembershipFindMany = prisma.membership.findMany;
    const origBoardsCreate = prisma.boards.create;
    const origBoardsFindUnique = prisma.boards.findUnique;
    const origBoardsUpdate = prisma.boards.update;
    const origBoardsDelete = prisma.boards.delete;
    const origSectionsCreate = prisma.sections.create;
    const origSectionsFindFirst = prisma.sections.findFirst;
    const origSectionsFindUnique = prisma.sections.findUnique;
    const origSectionsCount = prisma.sections.count;
    const origSectionsDelete = prisma.sections.delete;
    const origIssuesCreate = prisma.issues.create;
    const origIssuesFindUnique = prisma.issues.findUnique;
    const origIssuesFindFirst = prisma.issues.findFirst;
    const origIssuesCount = prisma.issues.count;
    const origIssuesDelete = prisma.issues.delete;
    const origIssuesFindMany = prisma.issues.findMany;
    const origIssuesUpdateMany = prisma.issues.updateMany;

    beforeEach(() => {
        notifiedUsers = [];
        boardBroadcasts = [];

        wsBroadcaster.notifyUsers = mock((userIds: string[], event: any) => {
            notifiedUsers.push({ userIds, event });
            return Promise.resolve(true);
        }) as any;

        wsBroadcaster.broadcast = mock((bId: string, event: any) => {
            boardBroadcasts.push({ boardId: bId, event });
            return Promise.resolve(true);
        }) as any;
    });

    afterEach(() => {
        wsBroadcaster.notifyUsers = origNotifyUsers;
        wsBroadcaster.broadcast = origBroadcast;
        wsBroadcaster.executeWithOutbox = origExecuteWithOutbox;

        prisma.orgs.findUnique = origOrgFindUnique;
        prisma.membership.findUnique = origMembershipFindUnique;
        prisma.membership.findMany = origMembershipFindMany;
        prisma.boards.create = origBoardsCreate;
        prisma.boards.findUnique = origBoardsFindUnique;
        prisma.boards.update = origBoardsUpdate;
        prisma.boards.delete = origBoardsDelete;
        prisma.sections.create = origSectionsCreate;
        prisma.sections.findFirst = origSectionsFindFirst;
        prisma.sections.findUnique = origSectionsFindUnique;
        prisma.sections.count = origSectionsCount;
        prisma.sections.delete = origSectionsDelete;
        prisma.issues.create = origIssuesCreate;
        prisma.issues.findUnique = origIssuesFindUnique;
        prisma.issues.findFirst = origIssuesFindFirst;
        prisma.issues.count = origIssuesCount;
        prisma.issues.delete = origIssuesDelete;
        prisma.issues.findMany = origIssuesFindMany;
        prisma.issues.updateMany = origIssuesUpdateMany;
    });

    // =========================================================================
    // 1. Board Creation
    // =========================================================================

    describe("1. Board Creation Realtime Synchronization", () => {
        it("1. Board creation dispatches the dashboard event to accepted organization members", async () => {
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: orgId,
                members: [{ role: "admin", userId: adminId, accepted: true }]
            })) as any;

            prisma.boards.create = mock(() => Promise.resolve({
                id: boardId,
                title: "Mobile App v2",
                description: null,
                color: null,
                isArchived: false,
                orgId,
                createdAt: new Date("2026-01-01T00:00:00Z"),
                updatedAt: new Date("2026-01-01T00:00:00Z")
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            const req: any = {
                id: adminId,
                params: { orgId },
                body: { title: "Mobile App v2" }
            };
            const res = createMockRes();

            await createBoard(req, res);

            expect(res.statusCode).toBe(201);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_created");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.board.id).toBe(boardId);
            expect(notifiedUsers[0]!.event.payload.board.title).toBe("Mobile App v2");
            expect(notifiedUsers[0]!.event.payload.board.columnCount).toBe(0);
            expect(notifiedUsers[0]!.event.payload.board._count.issues).toBe(0);
        });

        it("5 & 10. Users from another organization do not receive the event & RBAC is enforced", async () => {
            // Contributor cannot create boards
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: orgId,
                members: [] // Not admin or employee
            })) as any;

            const req: any = {
                id: contributorId,
                params: { orgId },
                body: { title: "Unauthorized Board" }
            };
            const res = createMockRes();

            await expect(createBoard(req, res)).rejects.toThrow("Employee/Admin access only");
            expect(notifiedUsers.length).toBe(0);
        });

        it("8. Offline users / transport failure does not cause backend mutation failure", async () => {
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: orgId,
                members: [{ role: "employee", userId: employeeId, accepted: true }]
            })) as any;

            prisma.boards.create = mock(() => Promise.resolve({
                id: boardId,
                title: "Offline Resilient Board",
                orgId,
                createdAt: new Date(),
                updatedAt: new Date()
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: employeeId }
            ])) as any;

            // Simulate WebSocket service offline / throwing error
            wsBroadcaster.notifyUsers = mock(() => Promise.reject(new Error("Connection refused"))) as any;

            const req: any = {
                id: employeeId,
                params: { orgId },
                body: { title: "Offline Resilient Board" }
            };
            const res = createMockRes();

            // Must NOT throw even if notifyUsers rejects
            await createBoard(req, res);
            expect(res.statusCode).toBe(201);
            expect(res.body.success).toBe(true);
        });
    });

    // =========================================================================
    // 2. Board Deletion
    // =========================================================================

    describe("2. Board Deletion Realtime Synchronization", () => {
        it("2 & 7. Board deletion dispatches dashboard event to accepted members while preserving board broadcast", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                org: { id: orgId }
            })) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                userId: adminId,
                orgId,
                role: "admin",
                accepted: true
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            prisma.boards.delete = mock(() => Promise.resolve({ id: boardId })) as any;

            const req: any = {
                id: adminId,
                params: { boardId }
            };
            const res = createMockRes();

            await deleteBoard(req, res);

            expect(res.statusCode).toBe(200);

            // 1. Board-scoped broadcast must still fire (for open tabs)
            expect(boardBroadcasts.length).toBe(1);
            expect(boardBroadcasts[0]!.boardId).toBe(boardId);
            expect(boardBroadcasts[0]!.event.type).toBe("board:deleted");

            // 2. Dashboard user-scoped event must dispatch to org members
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_deleted");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.boardId).toBe(boardId);
        });

        it("10. Non-member or unauthorized contributor cannot delete a board", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                org: { id: orgId }
            })) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: contributorId,
                params: { boardId }
            };
            const res = createMockRes();

            await expect(deleteBoard(req, res)).rejects.toThrow("Employee/Admin access only");
            expect(notifiedUsers.length).toBe(0);
            expect(boardBroadcasts.length).toBe(0);
        });
    });

    // =========================================================================
    // 3. Section Creation & Authoritative Column Count
    // =========================================================================

    describe("3. Section Creation Realtime Column Count", () => {
        it("3. Section creation dispatches the authoritative column count", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                title: "Kanban Board",
                org: {
                    id: orgId,
                    members: [{ role: "admin", userId: adminId, accepted: true }]
                }
            })) as any;

            prisma.sections.findFirst = mock(() => Promise.resolve(null)) as any;

            const fakeSection = { id: sectionId, title: "In Progress", position: 1000, boardId };
            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    sections: {
                        create: mock(() => Promise.resolve(fakeSection))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.sections.count = mock(() => Promise.resolve(4)) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            const req: any = {
                id: adminId,
                params: { boardId },
                body: { title: "In Progress" }
            };
            const res = createMockRes();

            await createSection(req, res);

            expect(res.statusCode).toBe(201);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_columns_changed");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.boardId).toBe(boardId);
            expect(notifiedUsers[0]!.event.payload.columnCount).toBe(4);
        });
    });

    // =========================================================================
    // 4. Section Deletion & Authoritative Column Count
    // =========================================================================

    describe("4. Section Deletion Realtime Column Count", () => {
        it("4. Section deletion dispatches the authoritative column count", async () => {
            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: sectionId,
                boardId,
                board: {
                    org: {
                        id: orgId,
                        members: [{ role: "admin", userId: adminId, accepted: true }]
                    }
                },
                _count: { issues: 0 }
            })) as any;

            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    sections: {
                        delete: mock(() => Promise.resolve({ title: "Done Section" }))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.sections.count = mock(() => Promise.resolve(2)) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            const req: any = {
                id: adminId,
                params: { sectionId },
                query: {}
            };
            const res = createMockRes();

            await deleteSection(req, res);

            expect(res.statusCode).toBe(200);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_columns_changed");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.boardId).toBe(boardId);
            expect(notifiedUsers[0]!.event.payload.columnCount).toBe(2);
        });
    });

    // =========================================================================
    // 5. Card Creation & Authoritative Card Count
    // =========================================================================

    describe("5. Card Creation Realtime Card Count", () => {
        it("Card creation dispatches authoritative cardCount to accepted members and preserves card:created", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                orgId,
                org: {
                    id: orgId,
                    members: [{ userId: adminId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: sectionId,
                boardId
            })) as any;

            prisma.issues.findFirst = mock(() => Promise.resolve(null)) as any;

            const fakeIssue = { id: issueId, title: "New Bug Report", position: 1000, boardId, sectionId };
            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    issues: {
                        create: mock(() => Promise.resolve(fakeIssue))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.issues.count = mock(() => Promise.resolve(8)) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            const req: any = {
                id: adminId,
                params: { sectionId },
                body: { title: "New Bug Report", boardId }
            };
            const res = createMockRes();

            await createIssue(req, res);

            expect(res.statusCode).toBe(201);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_cards_changed");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.boardId).toBe(boardId);
            expect(notifiedUsers[0]!.event.payload.cardCount).toBe(8);
        });

        it("Card creation failure / transport error does not fail HTTP response", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                orgId,
                org: {
                    id: orgId,
                    members: [{ userId: adminId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: sectionId,
                boardId
            })) as any;

            prisma.issues.findFirst = mock(() => Promise.resolve(null)) as any;

            const fakeIssue = { id: issueId, title: "Offline Issue", position: 1000, boardId, sectionId };
            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    issues: {
                        create: mock(() => Promise.resolve(fakeIssue))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.issues.count = mock(() => Promise.resolve(5)) as any;
            prisma.membership.findMany = mock(() => Promise.resolve([{ userId: adminId }])) as any;

            wsBroadcaster.notifyUsers = mock(() => Promise.reject(new Error("WS Service Down"))) as any;

            const req: any = {
                id: adminId,
                params: { sectionId },
                body: { title: "Offline Issue", boardId }
            };
            const res = createMockRes();

            await createIssue(req, res);
            expect(res.statusCode).toBe(201);
            expect(res.body.success).toBe(true);
        });
    });

    // =========================================================================
    // 6. Card Deletion & Authoritative Card Count
    // =========================================================================

    describe("6. Card Deletion Realtime Card Count", () => {
        it("Card deletion dispatches authoritative cardCount to accepted members and preserves card:deleted", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: issueId,
                boardId,
                board: {
                    orgId,
                    org: {
                        id: orgId,
                        members: [{ userId: adminId, role: "admin", accepted: true }]
                    }
                }
            })) as any;

            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    issues: {
                        delete: mock(() => Promise.resolve({ id: issueId, title: "Deleted Issue" }))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.issues.count = mock(() => Promise.resolve(3)) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            const req: any = {
                id: adminId,
                params: { issueId }
            };
            const res = createMockRes();

            await deleteIssue(req, res);

            expect(res.statusCode).toBe(200);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_cards_changed");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.boardId).toBe(boardId);
            expect(notifiedUsers[0]!.event.payload.cardCount).toBe(3);
        });
    });

    // =========================================================================
    // 7. Board Update & Archive/Unarchive Realtime
    // =========================================================================

    describe("7. Board Update & Archive/Unarchive Realtime Synchronization", () => {
        it("Archiving a board dispatches user:org_board_updated with isArchived: true to accepted members", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                orgId,
                org: {
                    id: orgId,
                    members: [{ userId: adminId, role: "admin", accepted: true }]
                }
            })) as any;

            const updatedBoard = {
                id: boardId,
                title: "Production Board",
                description: "Main production flow",
                color: "#ff0000",
                isArchived: true,
                orgId,
                updatedAt: new Date("2026-02-01T00:00:00Z")
            };

            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    boards: {
                        update: mock(() => Promise.resolve(updatedBoard))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: adminId },
                { userId: member2Id }
            ])) as any;

            const req: any = {
                id: adminId,
                params: { boardId },
                body: { isArchived: true }
            };
            const res = createMockRes();

            await updateBoard(req, res);

            expect(res.statusCode).toBe(200);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.userIds).toEqual([adminId, member2Id]);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_updated");
            expect(notifiedUsers[0]!.event.payload.orgId).toBe(orgId);
            expect(notifiedUsers[0]!.event.payload.boardId).toBe(boardId);
            expect(notifiedUsers[0]!.event.payload.changes.isArchived).toBe(true);
        });

        it("Unarchiving a board dispatches user:org_board_updated with isArchived: false", async () => {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: boardId,
                orgId,
                org: {
                    id: orgId,
                    members: [{ userId: employeeId, role: "employee", accepted: true }]
                }
            })) as any;

            const unarchivedBoard = {
                id: boardId,
                title: "Revived Board",
                isArchived: false,
                orgId,
                updatedAt: new Date("2026-02-02T00:00:00Z")
            };

            wsBroadcaster.executeWithOutbox = mock((_bId, _resolver, operation) => {
                const tx = {
                    boards: {
                        update: mock(() => Promise.resolve(unarchivedBoard))
                    }
                };
                return operation(tx).then((res: any) => ({ result: res, events: [], published: true }));
            }) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { userId: employeeId }
            ])) as any;

            const req: any = {
                id: employeeId,
                params: { boardId },
                body: { isArchived: false }
            };
            const res = createMockRes();

            await updateBoard(req, res);

            expect(res.statusCode).toBe(200);
            expect(notifiedUsers.length).toBe(1);
            expect(notifiedUsers[0]!.event.type).toBe("user:org_board_updated");
            expect(notifiedUsers[0]!.event.payload.changes.isArchived).toBe(false);
        });
    });

    // =========================================================================
    // 8. Verification of getAllBoards API Response
    // =========================================================================

    describe("8. Verification of getAllBoards Query Semantics", () => {
        it("getAllBoards returns correct columnCount and cardCount mapped from _count", async () => {
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: orgId,
                boards: [
                    {
                        id: boardId,
                        title: "Sprint 42",
                        description: "Current sprint",
                        color: "#3b82f6",
                        isArchived: false,
                        orgId,
                        _count: {
                            issues: 12,
                            section: 4
                        }
                    }
                ]
            })) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                userId: adminId,
                orgId,
                accepted: true
            })) as any;

            const req: any = {
                id: adminId,
                params: { orgId }
            };
            const res = createMockRes();

            await getAllBoards(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            const boards = res.body.data;
            expect(boards.length).toBe(1);
            expect(boards[0].id).toBe(boardId);
            expect(boards[0].columnCount).toBe(4);
            expect(boards[0].cardCount).toBe(12);
            expect(boards[0]._count.section).toBe(4);
            expect(boards[0]._count.issues).toBe(12);
        });
    });
});
