import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { createIssue } from "../../src/controllers/issues/createIssue";
import { createSection } from "../../src/controllers/sections/createSection";
import { updateIssue } from "../../src/controllers/issues/updateIssue";
import { OrgMembersHandler } from "../../src/controllers/organisation/allMembers";
import { deleteUserHandler } from "../../src/controllers/organisation/removeUser";
import { deleteSection } from "../../src/controllers/sections/deleteSection";
import { renameSection } from "../../src/controllers/sections/renameSection";
import { getAllSections } from "../../src/controllers/sections/getAllSections";
import { getAllIssues } from "../../src/controllers/issues/getAllIssues";
import { issueDetail } from "../../src/controllers/issues/issueDetail";
import { assignIssue } from "../../src/controllers/issues/assignIssue";
import { getBoardDetails } from "../../src/controllers/board/getaBoard";
import { loginHandler } from "../../src/controllers/loginHandler";
import { wsBroadcaster } from "../../src/services/broadcaster";
import { WebSocketBroadcaster as WsBroadcaster } from "../../../websockets/src/services/broadcaster";
import bcrypt from "bcrypt";

describe("Controller fixes unit tests", () =>
{
    const validBoardId = "11111111-1111-4111-8111-111111111111";
    const validSectionId = "22222222-2222-4222-8222-222222222222";
    const validTargetSectionId = "33333333-3333-4333-8333-333333333333";
    const validOrgId = "44444444-4444-4444-8444-444444444444";
    const otherBoardId = "55555555-5555-4555-8555-555555555555";
    const userId = "user-123";

    function createMockRes()
    {
        const res: any = {};
        res.status = mock((code: number) =>
        {
            res.statusCode = code;
            return res;
        });
        res.json = mock((payload: any) =>
        {
            res.body = payload;
            return res;
        });
        return res;
    }

    describe("createIssue cross-board validation and position handling", () =>
    {
        const origBoardFindUnique = prisma.boards.findUnique;
        const origSectionFindUnique = prisma.sections.findUnique;
        const origIssueCreate = prisma.issues.create;
        const origIssueCount = prisma.issues.count;
        const origIssueFindFirst = prisma.issues.findFirst;

        afterEach(() =>
        {
            prisma.boards.findUnique = origBoardFindUnique;
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.issues.create = origIssueCreate;
            prisma.issues.count = origIssueCount;
            prisma.issues.findFirst = origIssueFindFirst;
        });

        beforeEach(() =>
        {
            prisma.issues.count = mock(() => Promise.resolve(0)) as any;
            prisma.issues.findFirst = mock(() => Promise.resolve(null)) as any;
        });

        it("throws ValidationError when section belongs to a different board", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: validSectionId,
                boardId: otherBoardId // Different board!
            })) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { title: "Test Issue", boardId: validBoardId }
            };
            const res = createMockRes();

            await expect(createIssue(req, res)).rejects.toThrow("Section belongs to a different board");
        });

        it("throws Not_Found when section does not exist", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { title: "Test Issue", boardId: validBoardId }
            };
            const res = createMockRes();

            await expect(createIssue(req, res)).rejects.toThrow("Section not found");
        });

        it("creates issue when section belongs to board", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: validSectionId,
                boardId: validBoardId
            })) as any;

            prisma.issues.create = mock((args: any) => Promise.resolve({
                id: "issue-1",
                ...args.data
            })) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { title: "Test Issue", boardId: validBoardId }
            };
            const res = createMockRes();

            await createIssue(req, res);
            expect(res.statusCode).toBe(201);
            expect(res.body.data.title).toBe("Test Issue");
        });

        it("calculates default position as 1000 when no existing issues in section", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: validSectionId,
                boardId: validBoardId
            })) as any;

            prisma.issues.findFirst = mock(() => Promise.resolve(null)) as any;

            let createdData: any;
            prisma.issues.create = mock((args: any) =>
            {
                createdData = args.data;
                return Promise.resolve({
                    id: "issue-1",
                    ...args.data
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { title: "Test Issue", boardId: validBoardId }
            };
            const res = createMockRes();

            await createIssue(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.position).toBe(1000); // 0 + 1000
        });

        it("calculates default position based on highest existing issue position rather than count to prevent collisions", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: validSectionId,
                boardId: validBoardId
            })) as any;

            // Scenario: 3 issues previously existed (1000, 2000, 3000), issue 2 was deleted.
            // Remaining count is 2, but highest position is 3000.
            prisma.issues.findFirst = mock((args: any) =>
            {
                expect(args.where).toEqual({ sectionId: validSectionId });
                expect(args.orderBy).toEqual({ position: "desc" });
                return Promise.resolve({ position: 3000 });
            }) as any;

            let createdData: any;
            prisma.issues.create = mock((args: any) =>
            {
                createdData = args.data;
                return Promise.resolve({
                    id: "issue-1",
                    ...args.data
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { title: "Test Issue", boardId: validBoardId }
            };
            const res = createMockRes();

            await createIssue(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.position).toBe(4000); // 3000 + 1000, avoiding collision with existing issue at 3000
        });

        it("preserves explicit position when provided", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId, accepted: true }]
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: validSectionId,
                boardId: validBoardId
            })) as any;

            let createdData: any;
            prisma.issues.create = mock((args: any) =>
            {
                createdData = args.data;
                return Promise.resolve({
                    id: "issue-1",
                    ...args.data
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { title: "Test Issue", boardId: validBoardId, position: 1500 }
            };
            const res = createMockRes();

            await createIssue(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.position).toBe(1500);
        });
    });

    describe("createSection position handling and collision prevention", () =>
    {
        const origBoardFindUnique = prisma.boards.findUnique;
        const origSectionFindFirst = prisma.sections.findFirst;
        const origSectionCreate = prisma.sections.create;

        afterEach(() =>
        {
            prisma.boards.findUnique = origBoardFindUnique;
            prisma.sections.findFirst = origSectionFindFirst;
            prisma.sections.create = origSectionCreate;
        });

        it("calculates default position as 1000 when no sections exist", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                title: "Board 1",
                org: {
                    members: [{ userId, accepted: true, role: "admin" }]
                }
            })) as any;

            prisma.sections.findFirst = mock(() => Promise.resolve(null)) as any;

            let createdData: any;
            prisma.sections.create = mock((args: any) =>
            {
                createdData = args.data;
                return Promise.resolve({
                    id: "sec-1",
                    ...args.data
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { boardId: validBoardId },
                body: { title: "To Do" }
            };
            const res = createMockRes();

            await createSection(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.position).toBe(1000);
        });

        it("calculates default position based on highest existing section position (3000 + 1000 = 4000) preventing collision", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                title: "Board 1",
                org: {
                    members: [{ userId, accepted: true, role: "admin" }]
                }
            })) as any;

            // Scenario: sections existed at 1000, 2000, 3000. Section 2 was deleted.
            // Remaining count is 2, but highest position is 3000.
            prisma.sections.findFirst = mock((args: any) =>
            {
                expect(args.where).toEqual({ boardId: validBoardId });
                expect(args.orderBy).toEqual({ position: "desc" });
                return Promise.resolve({ position: 3000 });
            }) as any;

            let createdData: any;
            prisma.sections.create = mock((args: any) =>
            {
                createdData = args.data;
                return Promise.resolve({
                    id: "sec-4",
                    ...args.data
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { boardId: validBoardId },
                body: { title: "Done" }
            };
            const res = createMockRes();

            await createSection(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.position).toBe(4000); // 3000 + 1000, avoiding collision at 3000
        });

        it("preserves explicit position when provided", async () =>
        {
            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                title: "Board 1",
                org: {
                    members: [{ userId, accepted: true, role: "admin" }]
                }
            })) as any;

            let createdData: any;
            prisma.sections.create = mock((args: any) =>
            {
                createdData = args.data;
                return Promise.resolve({
                    id: "sec-custom",
                    ...args.data
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { boardId: validBoardId },
                body: { title: "Custom Position", position: 2500 }
            };
            const res = createMockRes();

            await createSection(req, res);
            expect(res.statusCode).toBe(201);
            expect(createdData.position).toBe(2500);
        });
    });

    describe("OrgMembersHandler authorization", () =>
    {
        const origMembershipFindUnique = prisma.membership.findUnique;
        const origMembershipFindMany = prisma.membership.findMany;

        afterEach(() =>
        {
            prisma.membership.findUnique = origMembershipFindUnique;
            prisma.membership.findMany = origMembershipFindMany;
        });

        it("throws Forbidden when requester is not an accepted member of the organization", async () =>
        {
            prisma.membership.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: "unauthorized-user",
                params: { orgId: validOrgId }
            };
            const res = createMockRes();

            await expect(OrgMembersHandler(req, res)).rejects.toThrow("Member access only");
        });

        it("returns member list with 200 status when requester is an accepted member", async () =>
        {
            prisma.membership.findUnique = mock(() => Promise.resolve({
                id: "mem-1",
                userId,
                orgId: validOrgId,
                accepted: true
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                { role: "admin", accepted: true, orgId: validOrgId, user: { username: "alice", email: "alice@test.com" } }
            ])) as any;

            const req: any = {
                id: userId,
                params: { orgId: validOrgId }
            };
            const res = createMockRes();

            await OrgMembersHandler(req, res);
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(1);
        });
    });

    describe("deleteSection issue handling", () =>
    {
        const origSectionFindUnique = prisma.sections.findUnique;
        const origSectionDelete = prisma.sections.delete;
        const origIssueUpdateMany = prisma.issues.updateMany;

        afterEach(() =>
        {
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.sections.delete = origSectionDelete;
            prisma.issues.updateMany = origIssueUpdateMany;
        });

        it("throws ValidationError when deleting non-empty section without targetSectionId", async () =>
        {
            prisma.sections.findUnique = mock(() => Promise.resolve({
                boardId: validBoardId,
                board: {
                    org: {
                        members: [{ userId, role: "admin" }]
                    }
                },
                _count: {
                    issues: 3
                }
            })) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                query: {},
                body: {}
            };
            const res = createMockRes();

            await expect(deleteSection(req, res)).rejects.toThrow(
                "targetSectionId is required to reassign issues when deleting a non-empty section"
            );
        });

        it("throws ValidationError when targetSectionId is the same section", async () =>
        {
            prisma.sections.findUnique = mock(() => Promise.resolve({
                boardId: validBoardId,
                board: {
                    org: {
                        members: [{ userId, role: "admin" }]
                    }
                },
                _count: {
                    issues: 2
                }
            })) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                query: { targetSectionId: validSectionId }
            };
            const res = createMockRes();

            await expect(deleteSection(req, res)).rejects.toThrow(
                "targetSectionId cannot be the same section being deleted"
            );
        });

        it("throws ValidationError when targetSectionId belongs to a different board", async () =>
        {
            prisma.sections.findUnique = mock((args: any) =>
            {
                if (args.where.id === validSectionId)
                {
                    return Promise.resolve({
                        boardId: validBoardId,
                        board: {
                            org: {
                                members: [{ userId, role: "admin" }]
                            }
                        },
                        _count: {
                            issues: 2
                        }
                    });
                }
                return Promise.resolve({
                    id: validTargetSectionId,
                    boardId: otherBoardId // Different board!
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                query: { targetSectionId: validTargetSectionId }
            };
            const res = createMockRes();

            await expect(deleteSection(req, res)).rejects.toThrow(
                "targetSectionId does not exist on this board"
            );
        });

        it("reassigns issues, deletes section inside transaction, and broadcasts card:moved when valid targetSectionId is provided", async () =>
        {
            let reassignedTo: string | undefined;
            const movedCards: any[] = [];
            let transactionCalled = false;

            const origTransaction = prisma.$transaction;
            const origIssueFindMany = prisma.issues.findMany;
            const origBroadcastCardMoved = wsBroadcaster.broadcastCardMoved;

            prisma.$transaction = mock(async (cb: any) =>
            {
                transactionCalled = true;
                return cb(prisma);
            }) as any;

            wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) =>
            {
                movedCards.push({ boardId, payload });
                return Promise.resolve(true);
            }) as any;

            prisma.sections.findUnique = mock((args: any) =>
            {
                if (args.where.id === validSectionId)
                {
                    return Promise.resolve({
                        boardId: validBoardId,
                        board: {
                            org: {
                                members: [{ userId, role: "admin" }]
                            }
                        },
                        _count: {
                            issues: 2
                        }
                    });
                }
                return Promise.resolve({
                    id: validTargetSectionId,
                    boardId: validBoardId,
                    title: "Destination Section"
                });
            }) as any;

            prisma.issues.findMany = mock(() => Promise.resolve([
                { id: "issue-1", position: 100 },
                { id: "issue-2", position: 200 }
            ])) as any;

            prisma.issues.updateMany = mock((args: any) =>
            {
                reassignedTo = args.data.sectionId;
                return Promise.resolve({ count: 2 });
            }) as any;

            prisma.sections.delete = mock(() => Promise.resolve({
                id: validSectionId,
                title: "To Delete"
            })) as any;

            try
            {
                const req: any = {
                    id: userId,
                    params: { sectionId: validSectionId },
                    query: { targetSectionId: validTargetSectionId }
                };
                const res = createMockRes();

                await deleteSection(req, res);
                expect(res.statusCode).toBe(200);
                expect(transactionCalled).toBe(true);
                expect(reassignedTo).toBe(validTargetSectionId);
                expect(movedCards.length).toBe(2);
                expect(movedCards[0]!.payload.cardId).toBe("issue-1");
                expect(movedCards[0]!.payload.destList).toBe(validTargetSectionId);
                expect(movedCards[1]!.payload.cardId).toBe("issue-2");
                expect(res.body.data).toBe("deleted section: To Delete and reassigned 2 issues");
            } finally
            {
                prisma.$transaction = origTransaction;
                prisma.issues.findMany = origIssueFindMany;
                wsBroadcaster.broadcastCardMoved = origBroadcastCardMoved;
            }
        });

        it("deletes empty section without requiring targetSectionId", async () =>
        {
            const origTransaction = prisma.$transaction;
            let transactionCalled = false;
            prisma.$transaction = mock(async (cb: any) =>
            {
                transactionCalled = true;
                return cb(prisma);
            }) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                boardId: validBoardId,
                board: {
                    org: {
                        members: [{ userId, role: "admin" }]
                    }
                },
                _count: {
                    issues: 0
                }
            })) as any;

            prisma.sections.delete = mock(() => Promise.resolve({
                id: validSectionId,
                title: "Empty Section"
            })) as any;

            try
            {
                const req: any = {
                    id: userId,
                    params: { sectionId: validSectionId },
                    query: {},
                    body: {}
                };
                const res = createMockRes();

                await deleteSection(req, res);
                expect(res.statusCode).toBe(200);
                expect(transactionCalled).toBe(true);
                expect(res.body.data).toBe("deleted section: Empty Section");
            } finally
            {
                prisma.$transaction = origTransaction;
            }
        });

        it("queries prisma with accepted: true and throws Forbidden when user is not an accepted admin", async () =>
        {
            let capturedArgs: any;
            prisma.sections.findUnique = mock((args: any) =>
            {
                capturedArgs = args;
                return Promise.resolve({
                    boardId: validBoardId,
                    board: {
                        org: {
                            members: []
                        }
                    },
                    _count: {
                        issues: 0
                    }
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                query: {},
                body: {}
            };
            const res = createMockRes();

            await expect(deleteSection(req, res)).rejects.toThrow("Admin access required");
            expect(capturedArgs.select.board.select.org.select.members.where).toEqual({
                userId,
                role: "admin",
                accepted: true
            });
        });
    });

    describe("renameSection position persistence", () =>
    {
        const origSectionFindUnique = prisma.sections.findUnique;
        const origSectionUpdate = prisma.sections.update;

        afterEach(() =>
        {
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.sections.update = origSectionUpdate;
        });

        it("persists position when position is provided", async () =>
        {
            let savedData: any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                title: "Existing Title",
                board: {
                    org: {
                        members: [{ userId, role: "admin" }]
                    }
                }
            })) as any;

            prisma.sections.update = mock((args: any) =>
            {
                savedData = args.data;
                return Promise.resolve({
                    id: validSectionId,
                    boardId: validBoardId,
                    title: "Existing Title",
                    position: args.data.position ?? 0
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId },
                body: { position: 42 }
            };
            const res = createMockRes();

            await renameSection(req, res);
            expect(res.statusCode).toBe(200);
            expect(savedData.position).toBe(42);
        });
    });

    describe("updateIssue position persistence and broadcasting", () =>
    {
        const validIssueId = "66666666-6666-4666-8666-666666666666";
        const origIssueFindUnique = prisma.issues.findUnique;
        const origSectionFindUnique = prisma.sections.findUnique;
        const origIssueUpdate = prisma.issues.update;
        const origBroadcastCardMoved = wsBroadcaster.broadcastCardMoved;
        const origBroadcastCardUpdated = wsBroadcaster.broadcastCardUpdated;

        afterEach(() =>
        {
            prisma.issues.findUnique = origIssueFindUnique;
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.issues.update = origIssueUpdate;
            wsBroadcaster.broadcastCardMoved = origBroadcastCardMoved;
            wsBroadcaster.broadcastCardUpdated = origBroadcastCardUpdated;
        });

        it("persists position to database and broadcasts card:moved", async () =>
        {
            let updateArgs: any;
            let broadcastArgs: any;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: validSectionId,
                board: {
                    org: {
                        members: [{ userId, accepted: true, role: "admin" }]
                    }
                }
            })) as any;

            prisma.issues.update = mock((args: any) =>
            {
                updateArgs = args;
                return Promise.resolve({
                    id: validIssueId,
                    boardId: validBoardId,
                    sectionId: validSectionId,
                    position: args.data.position
                });
            }) as any;

            wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) =>
            {
                broadcastArgs = { boardId, payload };
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: userId,
                params: { issueId: validIssueId },
                body: { position: 2500 }
            };
            const res = createMockRes();

            await updateIssue(req, res);
            expect(res.statusCode).toBe(200);
            expect(updateArgs.data.position).toBe(2500);
            expect(broadcastArgs.boardId).toBe(validBoardId);
            expect(broadcastArgs.payload.cardId).toBe(validIssueId);
            expect(broadcastArgs.payload.position).toBe(2500);
        });

        it("persists section move with position and broadcasts card:moved", async () =>
        {
            let updateArgs: any;
            let broadcastArgs: any;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                boardId: validBoardId,
                sectionId: validSectionId,
                board: {
                    org: {
                        members: [{ userId, accepted: true, role: "employee" }]
                    }
                }
            })) as any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                id: validTargetSectionId,
                boardId: validBoardId
            })) as any;

            prisma.issues.update = mock((args: any) =>
            {
                updateArgs = args;
                return Promise.resolve({
                    id: validIssueId,
                    boardId: validBoardId,
                    sectionId: validTargetSectionId,
                    position: args.data.position
                });
            }) as any;

            wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) =>
            {
                broadcastArgs = { boardId, payload };
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: userId,
                params: { issueId: validIssueId },
                body: { sectionId: validTargetSectionId, position: 1000 }
            };
            const res = createMockRes();

            await updateIssue(req, res);
            expect(res.statusCode).toBe(200);
            expect(updateArgs.data.sectionId).toBe(validTargetSectionId);
            expect(updateArgs.data.position).toBe(1000);
            expect(broadcastArgs.payload.sourceList).toBe(validSectionId);
            expect(broadcastArgs.payload.destList).toBe(validTargetSectionId);
            expect(broadcastArgs.payload.position).toBe(1000);
        });
    });

    describe("Organization Member Eviction Scoping", () =>
    {
        it("passes boardIds of organization to wsBroadcaster.evictUser", async () =>
        {
            const origOrgFind = prisma.orgs.findUnique;
            const origMemberDelete = prisma.membership.delete;
            const origBoardsFind = prisma.boards.findMany;
            const origEvictUser = wsBroadcaster.evictUser;
            const origBroadcast = wsBroadcaster.broadcast;

            const targetUserEmail = "member-to-remove@example.com";
            const targetUserId = "member-uid-999";

            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                members: [
                    { userId: userId, role: "admin", user: { email: "admin@example.com" } },
                    { userId: targetUserId, role: "employee", user: { email: targetUserEmail } }
                ],
                _count: { members: 1 }
            })) as any;

            prisma.membership.delete = mock(() => Promise.resolve({})) as any;
            prisma.boards.findMany = mock(() => Promise.resolve([
                { id: "board-111" },
                { id: "board-222" }
            ])) as any;

            let evictUserArgs: any = null;
            wsBroadcaster.evictUser = mock((uid: string, orgId?: string, boardIds?: string[]) =>
            {
                evictUserArgs = { uid, orgId, boardIds };
                return Promise.resolve(true);
            }) as any;
            wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

            const req: any = {
                id: userId,
                params: { orgId: validOrgId },
                body: { email: targetUserEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(evictUserArgs).not.toBeNull();
            expect(evictUserArgs.uid).toBe(targetUserId);
            expect(evictUserArgs.orgId).toBe(validOrgId);
            expect(evictUserArgs.boardIds).toEqual(["board-111", "board-222"]);

            prisma.orgs.findUnique = origOrgFind;
            prisma.membership.delete = origMemberDelete;
            prisma.boards.findMany = origBoardsFind;
            wsBroadcaster.evictUser = origEvictUser;
            wsBroadcaster.broadcast = origBroadcast;
        });

        it("deleteUserHandler succeeds when wsBroadcaster comes from websockets broadcaster instance in dual-server mode", async () =>
        {
            const origOrgFind = prisma.orgs.findUnique;
            const origMemberDelete = prisma.membership.delete;
            const origBoardsFind = prisma.boards.findMany;
            const origEvictUser = wsBroadcaster.evictUser;
            const origBroadcast = wsBroadcaster.broadcast;

            const targetUserEmail = "dual-server-member@example.com";
            const targetUserId = "member-uid-dual-1";

            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                members: [
                    { userId: userId, role: "admin", user: { email: "admin@example.com" } },
                    { userId: targetUserId, role: "employee", user: { email: targetUserEmail } }
                ],
                _count: { members: 1 }
            })) as any;

            prisma.membership.delete = mock(() => Promise.resolve({})) as any;
            prisma.boards.findMany = mock(() => Promise.resolve([{ id: "board-dual-1" }])) as any;

            // Instantiate WebSocketBroadcaster from websockets app
            const wsServerBroadcaster = new WsBroadcaster();
            let evictionHandlerCalled = false;
            wsServerBroadcaster.setEvictionHandler(async (opts) =>
            {
                evictionHandlerCalled = true;
                expect(opts.userId).toBe(targetUserId);
                expect(opts.orgId).toBe(validOrgId);
                expect(opts.boardIds).toEqual(["board-dual-1"]);
                return 1;
            });

            // Replicate dual-server singleton behavior: backend uses wsBroadcaster which has evictUser
            wsBroadcaster.evictUser = wsServerBroadcaster.evictUser.bind(wsServerBroadcaster);
            wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

            const req: any = {
                id: userId,
                params: { orgId: validOrgId },
                body: { email: targetUserEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(evictionHandlerCalled).toBe(true);

            prisma.orgs.findUnique = origOrgFind;
            prisma.membership.delete = origMemberDelete;
            prisma.boards.findMany = origBoardsFind;
            wsBroadcaster.evictUser = origEvictUser;
            wsBroadcaster.broadcast = origBroadcast;
        });

        it("deleteUserHandler succeeds and returns 200 even when wsBroadcaster.evictUser throws an unexpected error", async () =>
        {
            const origOrgFind = prisma.orgs.findUnique;
            const origMemberDelete = prisma.membership.delete;
            const origBoardsFind = prisma.boards.findMany;
            const origEvictUser = wsBroadcaster.evictUser;
            const origBroadcast = wsBroadcaster.broadcast;

            const targetUserEmail = "member-throwing@example.com";
            const targetUserId = "member-uid-throw";

            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                members: [
                    { userId: userId, role: "admin", user: { email: "admin@example.com" } },
                    { userId: targetUserId, role: "employee", user: { email: targetUserEmail } }
                ],
                _count: { members: 1 }
            })) as any;

            prisma.membership.delete = mock(() => Promise.resolve({})) as any;
            prisma.boards.findMany = mock(() => Promise.resolve([{ id: "board-1" }])) as any;

            wsBroadcaster.evictUser = mock(() =>
            {
                throw new Error("Unexpected network crash during eviction");
            }) as any;
            wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

            const req: any = {
                id: userId,
                params: { orgId: validOrgId },
                body: { email: targetUserEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBe("user deleted");

            prisma.orgs.findUnique = origOrgFind;
            prisma.membership.delete = origMemberDelete;
            prisma.boards.findMany = origBoardsFind;
            wsBroadcaster.evictUser = origEvictUser;
            wsBroadcaster.broadcast = origBroadcast;
        });

        it("deleteUserHandler succeeds when wsBroadcaster.evictUser is undefined or not a function", async () =>
        {
            const origOrgFind = prisma.orgs.findUnique;
            const origMemberDelete = prisma.membership.delete;
            const origBoardsFind = prisma.boards.findMany;
            const origEvictUser = wsBroadcaster.evictUser;
            const origBroadcast = wsBroadcaster.broadcast;

            const targetUserEmail = "member-undef@example.com";
            const targetUserId = "member-uid-undef";

            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                members: [
                    { userId: userId, role: "admin", user: { email: "admin@example.com" } },
                    { userId: targetUserId, role: "employee", user: { email: targetUserEmail } }
                ],
                _count: { members: 1 }
            })) as any;

            prisma.membership.delete = mock(() => Promise.resolve({})) as any;
            prisma.boards.findMany = mock(() => Promise.resolve([{ id: "board-1" }])) as any;

            // Simulate legacy / missing evictUser method
            (wsBroadcaster as any).evictUser = undefined;
            wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

            const req: any = {
                id: userId,
                params: { orgId: validOrgId },
                body: { email: targetUserEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);

            prisma.orgs.findUnique = origOrgFind;
            prisma.membership.delete = origMemberDelete;
            prisma.boards.findMany = origBoardsFind;
            wsBroadcaster.evictUser = origEvictUser;
            wsBroadcaster.broadcast = origBroadcast;
        });

        it("deleteUserHandler awaits all board broadcasts and logs warning if evictUser returns false", async () =>
        {
            const origOrgFind = prisma.orgs.findUnique;
            const origMemberDelete = prisma.membership.delete;
            const origBoardsFind = prisma.boards.findMany;
            const origEvictUser = wsBroadcaster.evictUser;
            const origBroadcast = wsBroadcaster.broadcast;
            const origWarn = console.warn;

            const targetUserEmail = "member-unack@example.com";
            const targetUserId = "member-uid-unack";

            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                members: [
                    { userId: userId, role: "admin", user: { email: "admin@example.com" } },
                    { userId: targetUserId, role: "employee", user: { email: targetUserEmail } }
                ],
                _count: { members: 1 }
            })) as any;

            prisma.membership.delete = mock(() => Promise.resolve({})) as any;
            prisma.boards.findMany = mock(() => Promise.resolve([{ id: "b-1" }, { id: "b-2" }])) as any;

            const broadcastCalls: string[] = [];
            wsBroadcaster.broadcast = mock((boardId: string) =>
            {
                broadcastCalls.push(boardId);
                return Promise.resolve(true);
            }) as any;

            let warnMessage = "";
            console.warn = mock((msg: string) =>
            {
                warnMessage = msg;
            });

            // evictUser returns false (e.g. unacknowledged)
            wsBroadcaster.evictUser = mock(() => Promise.resolve(false)) as any;

            const req: any = {
                id: userId,
                params: { orgId: validOrgId },
                body: { email: targetUserEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(broadcastCalls).toEqual(["b-1", "b-2"]);
            expect(warnMessage).toContain("WebSocket eviction was not acknowledged");

            prisma.orgs.findUnique = origOrgFind;
            prisma.membership.delete = origMemberDelete;
            prisma.boards.findMany = origBoardsFind;
            wsBroadcaster.evictUser = origEvictUser;
            wsBroadcaster.broadcast = origBroadcast;
            console.warn = origWarn;
        });

        describe("Revoking Pending Invitations in deleteUserHandler", () =>
        {
            const pendingUserEmail = "pending@example.com";
            const pendingUserId = "pending-uid-1";

            it("queries both accepted and pending members without where.accepted filter on members", async () =>
            {
                const origOrgFind = prisma.orgs.findUnique;
                const origMemberDelete = prisma.membership.delete;
                const origBoardsFind = prisma.boards.findMany;
                const origBroadcast = wsBroadcaster.broadcast;

                let findArgs: any = null;
                prisma.orgs.findUnique = mock((args: any) =>
                {
                    findArgs = args;
                    return Promise.resolve({
                        id: validOrgId,
                        members: [
                            { userId: userId, role: "admin", accepted: true, user: { email: "admin@example.com" } },
                            { userId: pendingUserId, role: "contributor", accepted: false, user: { email: pendingUserEmail } }
                        ],
                        _count: { members: 1 }
                    });
                }) as any;

                prisma.membership.delete = mock(() => Promise.resolve({})) as any;
                prisma.boards.findMany = mock(() => Promise.resolve([])) as any;
                wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

                const req: any = {
                    id: userId,
                    params: { orgId: validOrgId },
                    body: { email: pendingUserEmail }
                };
                const res = createMockRes();

                await deleteUserHandler(req, res);

                expect(res.statusCode).toBe(200);
                expect(findArgs.select.members.where).toBeUndefined();
                expect(findArgs.select.members.select.accepted).toBe(true);

                prisma.orgs.findUnique = origOrgFind;
                prisma.membership.delete = origMemberDelete;
                prisma.boards.findMany = origBoardsFind;
                wsBroadcaster.broadcast = origBroadcast;
            });

            it("allows admin to revoke pending invitation (accepted: false)", async () =>
            {
                const origOrgFind = prisma.orgs.findUnique;
                const origMemberDelete = prisma.membership.delete;
                const origBoardsFind = prisma.boards.findMany;
                const origBroadcast = wsBroadcaster.broadcast;

                let deletedMembershipWhere: any = null;
                prisma.orgs.findUnique = mock(() => Promise.resolve({
                    id: validOrgId,
                    members: [
                        { userId: userId, role: "admin", accepted: true, user: { email: "admin@example.com" } },
                        { userId: pendingUserId, role: "contributor", accepted: false, user: { email: pendingUserEmail } }
                    ],
                    _count: { members: 1 }
                })) as any;

                prisma.membership.delete = mock((args: any) =>
                {
                    deletedMembershipWhere = args.where;
                    return Promise.resolve({});
                }) as any;
                prisma.boards.findMany = mock(() => Promise.resolve([])) as any;
                wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

                const req: any = {
                    id: userId,
                    params: { orgId: validOrgId },
                    body: { email: pendingUserEmail }
                };
                const res = createMockRes();

                await deleteUserHandler(req, res);

                expect(res.statusCode).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.data).toBe("user deleted");
                expect(deletedMembershipWhere).toEqual({
                    userId_orgId: {
                        userId: pendingUserId,
                        orgId: validOrgId
                    }
                });

                prisma.orgs.findUnique = origOrgFind;
                prisma.membership.delete = origMemberDelete;
                prisma.boards.findMany = origBoardsFind;
                wsBroadcaster.broadcast = origBroadcast;
            });

            it("prevents non-admin member from deleting a pending invitation", async () =>
            {
                const origOrgFind = prisma.orgs.findUnique;
                const nonAdminUserId = "non-admin-user";

                prisma.orgs.findUnique = mock(() => Promise.resolve({
                    id: validOrgId,
                    members: [
                        { userId: nonAdminUserId, role: "employee", accepted: true, user: { email: "employee@example.com" } },
                        { userId: pendingUserId, role: "contributor", accepted: false, user: { email: pendingUserEmail } }
                    ],
                    _count: { members: 1 }
                })) as any;

                const req: any = {
                    id: nonAdminUserId,
                    params: { orgId: validOrgId },
                    body: { email: pendingUserEmail }
                };
                const res = createMockRes();

                expect(deleteUserHandler(req, res)).rejects.toThrow("Admin access required");

                prisma.orgs.findUnique = origOrgFind;
            });

            it("prevents the invited user from deleting their own pending invitation via removeUser", async () =>
            {
                const origOrgFind = prisma.orgs.findUnique;

                prisma.orgs.findUnique = mock(() => Promise.resolve({
                    id: validOrgId,
                    members: [
                        { userId: "some-admin-id", role: "admin", accepted: true, user: { email: "admin@example.com" } },
                        { userId: pendingUserId, role: "contributor", accepted: false, user: { email: pendingUserEmail } }
                    ],
                    _count: { members: 1 }
                })) as any;

                const req: any = {
                    id: pendingUserId,
                    params: { orgId: validOrgId },
                    body: { email: pendingUserEmail }
                };
                const res = createMockRes();

                expect(deleteUserHandler(req, res)).rejects.toThrow("Admin access required");

                prisma.orgs.findUnique = origOrgFind;
            });

            it("throws Not_Found when email is not found among org members", async () =>
            {
                const origOrgFind = prisma.orgs.findUnique;

                prisma.orgs.findUnique = mock(() => Promise.resolve({
                    id: validOrgId,
                    members: [
                        { userId: userId, role: "admin", accepted: true, user: { email: "admin@example.com" } }
                    ],
                    _count: { members: 1 }
                })) as any;

                const req: any = {
                    id: userId,
                    params: { orgId: validOrgId },
                    body: { email: "notfound@example.com" }
                };
                const res = createMockRes();

                expect(deleteUserHandler(req, res)).rejects.toThrow("User not a member");

                prisma.orgs.findUnique = origOrgFind;
            });

            it("does not trigger admin lockout when revoking a pending invitation with role admin", async () =>
            {
                const origOrgFind = prisma.orgs.findUnique;
                const origMemberDelete = prisma.membership.delete;
                const origBoardsFind = prisma.boards.findMany;
                const origBroadcast = wsBroadcaster.broadcast;

                const pendingAdminEmail = "pendingadmin@example.com";
                const pendingAdminId = "pending-admin-id";

                prisma.orgs.findUnique = mock(() => Promise.resolve({
                    id: validOrgId,
                    members: [
                        { userId: userId, role: "admin", accepted: true, user: { email: "admin@example.com" } },
                        { userId: pendingAdminId, role: "admin", accepted: false, user: { email: pendingAdminEmail } }
                    ],
                    _count: { members: 1 }
                })) as any;

                prisma.membership.delete = mock(() => Promise.resolve({})) as any;
                prisma.boards.findMany = mock(() => Promise.resolve([])) as any;
                wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

                const req: any = {
                    id: userId,
                    params: { orgId: validOrgId },
                    body: { email: pendingAdminEmail }
                };
                const res = createMockRes();

                await deleteUserHandler(req, res);

                expect(res.statusCode).toBe(200);

                prisma.orgs.findUnique = origOrgFind;
                prisma.membership.delete = origMemberDelete;
                prisma.boards.findMany = origBoardsFind;
                wsBroadcaster.broadcast = origBroadcast;
            });
        });
    });

    describe("Deterministic Query Ordering with Compound Sort Criteria", () =>
    {
        it("getaBoard queries sections and issues with position and secondary tie-breakers", async () =>
        {
            const origBoardFind = prisma.boards.findUnique;
            const origMemberFind = prisma.membership.findUnique;

            let queryArgs: any = null;
            prisma.boards.findUnique = mock((args: any) =>
            {
                queryArgs = args;
                return Promise.resolve({
                    id: validBoardId,
                    title: "Test Board",
                    orgId: validOrgId,
                    section: []
                });
            }) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                role: "admin",
                accepted: true
            })) as any;

            const req: any = {
                id: userId,
                params: { boardId: validBoardId }
            };
            const res = createMockRes();

            await getBoardDetails(req, res);

            expect(res.statusCode).toBe(200);
            expect(queryArgs.select.section.orderBy).toEqual([
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" }
            ]);
            expect(queryArgs.select.section.select.issues.orderBy).toEqual([
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" }
            ]);

            prisma.boards.findUnique = origBoardFind;
            prisma.membership.findUnique = origMemberFind;
        });

        it("getAllSections queries sections with position and secondary tie-breakers", async () =>
        {
            const origBoardFind = prisma.boards.findUnique;

            let queryArgs: any = null;
            prisma.boards.findUnique = mock((args: any) =>
            {
                queryArgs = args;
                return Promise.resolve({
                    id: validBoardId,
                    section: [],
                    org: { members: [{ id: "m-1" }] }
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { boardId: validBoardId }
            };
            const res = createMockRes();

            await getAllSections(req, res);

            expect(res.statusCode).toBe(200);
            expect(queryArgs.select.section.orderBy).toEqual([
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" }
            ]);

            prisma.boards.findUnique = origBoardFind;
        });

        it("getAllIssues queries issues with position and secondary tie-breakers", async () =>
        {
            const origSectionFind = prisma.sections.findUnique;

            let queryArgs: any = null;
            prisma.sections.findUnique = mock((args: any) =>
            {
                queryArgs = args;
                return Promise.resolve({
                    title: "Backlog",
                    issues: [],
                    board: { org: { members: [{ id: "m-1" }] } }
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { sectionId: validSectionId }
            };
            const res = createMockRes();

            await getAllIssues(req, res);

            expect(res.statusCode).toBe(200);
            expect(queryArgs.select.issues.orderBy).toEqual([
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" }
            ]);

            prisma.sections.findUnique = origSectionFind;
        });

        it("issueDetail queries checklists and checklist items with position and secondary tie-breakers", async () =>
        {
            const origIssueFind = prisma.issues.findUnique;

            let queryArgs: any = null;
            prisma.issues.findUnique = mock((args: any) =>
            {
                queryArgs = args;
                return Promise.resolve({
                    id: "issue-abc",
                    title: "Issue with Checklists",
                    board: {
                        title: "Test Board",
                        id: validBoardId,
                        org: {
                            members: [{ id: "m-1" }]
                        }
                    },
                    section: { id: validSectionId, title: "Todo" },
                    issueMappings: [],
                    checklists: [
                        {
                            id: "cl-1",
                            title: "Checklist 1",
                            position: 1000,
                            items: []
                        }
                    ],
                    labels: []
                });
            }) as any;

            const req: any = {
                id: userId,
                params: { issueId: validBoardId }
            };
            const res = createMockRes();

            await issueDetail(req, res);

            expect(res.statusCode).toBe(200);
            expect(queryArgs.select.checklists.orderBy).toEqual([
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" }
            ]);
            expect(queryArgs.select.checklists.select.items.orderBy).toEqual([
                { position: "asc" },
                { createdAt: "asc" },
                { id: "asc" }
            ]);

            prisma.issues.findUnique = origIssueFind;
        });
    });

    describe("assignIssue duplicate email handling and broadcast scoping", () =>
    {
        const validIssueId = "77777777-7777-4777-8777-777777777777";
        const origIssueFindUnique = prisma.issues.findUnique;
        const origMembershipFindMany = prisma.membership.findMany;
        const origIssueMappingCreateMany = prisma.issue_mapping.createMany;
        const origBroadcast = wsBroadcaster.broadcast;

        afterEach(() =>
        {
            prisma.issues.findUnique = origIssueFindUnique;
            prisma.membership.findMany = origMembershipFindMany;
            prisma.issue_mapping.createMany = origIssueMappingCreateMany;
            wsBroadcaster.broadcast = origBroadcast;
        });

        it("handles duplicate emails without throwing ValidationError and creates single assignment", async () =>
        {
            let membershipWhere: any = null;
            let createManyData: any = null;
            let broadcastPayload: any = null;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                board: {
                    id: validBoardId,
                    org: {
                        id: validOrgId,
                        members: [{ userId, role: "admin", accepted: true }]
                    }
                }
            })) as any;

            prisma.membership.findMany = mock((args: any) =>
            {
                membershipWhere = args.where;
                return Promise.resolve([
                    {
                        userId: "user-dup-1",
                        user: {
                            email: "dev@example.com",
                            issueMappings: []
                        }
                    }
                ]);
            }) as any;

            prisma.issue_mapping.createMany = mock((args: any) =>
            {
                createManyData = args.data;
                return Promise.resolve({ count: args.data.length });
            }) as any;

            wsBroadcaster.broadcast = mock((boardId: string, event: any) =>
            {
                broadcastPayload = event;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: userId,
                params: { issueId: validIssueId },
                body: { email: ["dev@example.com", "dev@example.com"] }
            };
            const res = createMockRes();

            await assignIssue(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBe("assigned 1");
            expect(membershipWhere.user.email.in).toEqual(["dev@example.com"]);
            expect(createManyData).toEqual([{ userId: "user-dup-1", issueId: validIssueId }]);
            expect(broadcastPayload.type).toBe("card:member_assigned");
            expect(broadcastPayload.payload.assignedUsers).toEqual([
                { userId: "user-dup-1", email: "dev@example.com" }
            ]);
        });

        it("broadcasts only newly assigned users (entriesToCreate) and excludes users who were already assigned", async () =>
        {
            let createManyData: any = null;
            let broadcastPayload: any = null;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                board: {
                    id: validBoardId,
                    org: {
                        id: validOrgId,
                        members: [{ userId, role: "admin", accepted: true }]
                    }
                }
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                {
                    userId: "user-already-assigned",
                    user: {
                        email: "already@example.com",
                        issueMappings: [{ userId: "user-already-assigned" }]
                    }
                },
                {
                    userId: "user-newly-assigned",
                    user: {
                        email: "new@example.com",
                        issueMappings: []
                    }
                }
            ])) as any;

            prisma.issue_mapping.createMany = mock((args: any) =>
            {
                createManyData = args.data;
                return Promise.resolve({ count: args.data.length });
            }) as any;

            wsBroadcaster.broadcast = mock((boardId: string, event: any) =>
            {
                broadcastPayload = event;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: userId,
                params: { issueId: validIssueId },
                body: { email: ["already@example.com", "new@example.com"] }
            };
            const res = createMockRes();

            await assignIssue(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBe("assigned 1");
            expect(createManyData).toEqual([{ userId: "user-newly-assigned", issueId: validIssueId }]);
            expect(broadcastPayload.payload.assignedUsers).toEqual([
                { userId: "user-newly-assigned", email: "new@example.com" }
            ]);
        });

        it("returns 'Already assigned' without broadcasting when all requested users are already assigned", async () =>
        {
            let broadcastCalled = false;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                board: {
                    id: validBoardId,
                    org: {
                        id: validOrgId,
                        members: [{ userId, role: "admin", accepted: true }]
                    }
                }
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                {
                    userId: "user-already-assigned",
                    user: {
                        email: "already@example.com",
                        issueMappings: [{ userId: "user-already-assigned" }]
                    }
                }
            ])) as any;

            wsBroadcaster.broadcast = mock(() =>
            {
                broadcastCalled = true;
                return Promise.resolve(true);
            }) as any;

            const req: any = {
                id: userId,
                params: { issueId: validIssueId },
                body: { email: ["already@example.com", "already@example.com"] }
            };
            const res = createMockRes();

            await assignIssue(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBe("Already assigned");
            expect(broadcastCalled).toBe(false);
        });

        it("throws ValidationError when an email does not belong to an org member", async () =>
        {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                board: {
                    id: validBoardId,
                    org: {
                        id: validOrgId,
                        members: [{ userId, role: "admin", accepted: true }]
                    }
                }
            })) as any;

            prisma.membership.findMany = mock(() => Promise.resolve([
                {
                    userId: "user-1",
                    user: {
                        email: "valid@example.com",
                        issueMappings: []
                    }
                }
            ])) as any;

            const req: any = {
                id: userId,
                params: { issueId: validIssueId },
                body: { email: ["valid@example.com", "nonmember@example.com"] }
            };
            const res = createMockRes();

            await expect(assignIssue(req, res)).rejects.toThrow("One or more emails invalid or already assigned");
        });
    });

    describe("loginHandler user enumeration and timing mitigation", () =>
    {
        const origUserFindUnique = prisma.user.findUnique;

        afterEach(() =>
        {
            (prisma.user as any).findUnique = origUserFindUnique;
        });

        it("returns 400 when input validation fails", async () =>
        {
            const req: any = {
                body: { email: "not-an-email", password: "short" }
            };
            const res = createMockRes();

            await loginHandler(req, res);

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Invalid inputs");
        });

        it("returns 401 with 'Invalid email or password' when user does not exist (not 404)", async () =>
        {
            (prisma.user as any).findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                body: { email: "nonexistent@example.com", password: "password123" }
            };
            const res = createMockRes();

            await loginHandler(req, res);

            expect(res.statusCode).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Invalid email or password");
        });

        it("returns 401 with 'Invalid email or password' when password is wrong (not 'Invalid Password')", async () =>
        {
            const hashedPassword = await bcrypt.hash("correct-password", 10);
            (prisma.user as any).findUnique = mock(() => Promise.resolve({
                id: "user-uuid-1",
                email: "user@example.com",
                password: hashedPassword
            })) as any;

            const req: any = {
                body: { email: "user@example.com", password: "wrong-password" }
            };
            const res = createMockRes();

            await loginHandler(req, res);

            expect(res.statusCode).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Invalid email or password");
        });

        it("returns 200 with JWT token when credentials are valid", async () =>
        {
            const rawPassword = "valid-password123";
            const hashedPassword = await bcrypt.hash(rawPassword, 10);
            (prisma.user as any).findUnique = mock(() => Promise.resolve({
                id: "user-uuid-1",
                email: "user@example.com",
                password: hashedPassword
            })) as any;

            const req: any = {
                body: { email: "user@example.com", password: rawPassword }
            };
            const res = createMockRes();

            await loginHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(typeof res.body.data).toBe("string");
        });

        it("returns 500 when database throws an unexpected error", async () =>
        {
            (prisma.user as any).findUnique = mock(() => Promise.reject(new Error("DB connection lost"))) as any;

            const req: any = {
                body: { email: "user@example.com", password: "password123" }
            };
            const res = createMockRes();

            await loginHandler(req, res);

            expect(res.statusCode).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Internal Server error");
        });
    });
});

