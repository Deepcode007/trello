import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { createIssue } from "../../src/controllers/issues/createIssue";
import { updateIssue } from "../../src/controllers/issues/updateIssue";
import { OrgMembersHandler } from "../../src/controllers/organisation/allMembers";
import { deleteSection } from "../../src/controllers/sections/deleteSection";
import { renameSection } from "../../src/controllers/sections/renameSection";
import { wsBroadcaster } from "../../src/services/broadcaster";

describe("Controller fixes unit tests", () => {
    const validBoardId = "11111111-1111-4111-8111-111111111111";
    const validSectionId = "22222222-2222-4222-8222-222222222222";
    const validTargetSectionId = "33333333-3333-4333-8333-333333333333";
    const validOrgId = "44444444-4444-4444-8444-444444444444";
    const otherBoardId = "55555555-5555-4555-8555-555555555555";
    const userId = "user-123";

    function createMockRes() {
        const res: any = {};
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

    describe("createIssue cross-board validation and position handling", () => {
        const origBoardFindUnique = prisma.boards.findUnique;
        const origSectionFindUnique = prisma.sections.findUnique;
        const origIssueCreate = prisma.issues.create;
        const origIssueCount = prisma.issues.count;

        afterEach(() => {
            prisma.boards.findUnique = origBoardFindUnique;
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.issues.create = origIssueCreate;
            prisma.issues.count = origIssueCount;
        });

        beforeEach(() => {
            prisma.issues.count = mock(() => Promise.resolve(0)) as any;
        });

        it("throws ValidationError when section belongs to a different board", async () => {
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

        it("throws Not_Found when section does not exist", async () => {
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

        it("creates issue when section belongs to board", async () => {
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

        it("calculates default position based on existing issue count when not provided", async () => {
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

            prisma.issues.count = mock(() => Promise.resolve(2)) as any;

            let createdData: any;
            prisma.issues.create = mock((args: any) => {
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
            expect(createdData.position).toBe(3000); // (2 + 1) * 1000
        });

        it("preserves explicit position when provided", async () => {
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
            prisma.issues.create = mock((args: any) => {
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

    describe("OrgMembersHandler authorization", () => {
        const origMembershipFindUnique = prisma.membership.findUnique;
        const origMembershipFindMany = prisma.membership.findMany;

        afterEach(() => {
            prisma.membership.findUnique = origMembershipFindUnique;
            prisma.membership.findMany = origMembershipFindMany;
        });

        it("throws Forbidden when requester is not an accepted member of the organization", async () => {
            prisma.membership.findUnique = mock(() => Promise.resolve(null)) as any;

            const req: any = {
                id: "unauthorized-user",
                params: { orgId: validOrgId }
            };
            const res = createMockRes();

            await expect(OrgMembersHandler(req, res)).rejects.toThrow("Member access only");
        });

        it("returns member list with 200 status when requester is an accepted member", async () => {
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

    describe("deleteSection issue handling", () => {
        const origSectionFindUnique = prisma.sections.findUnique;
        const origSectionDelete = prisma.sections.delete;
        const origIssueUpdateMany = prisma.issues.updateMany;

        afterEach(() => {
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.sections.delete = origSectionDelete;
            prisma.issues.updateMany = origIssueUpdateMany;
        });

        it("throws ValidationError when deleting non-empty section without targetSectionId", async () => {
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

        it("throws ValidationError when targetSectionId is the same section", async () => {
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

        it("throws ValidationError when targetSectionId belongs to a different board", async () => {
            prisma.sections.findUnique = mock((args: any) => {
                if (args.where.id === validSectionId) {
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

        it("reassigns issues, deletes section inside transaction, and broadcasts card:moved when valid targetSectionId is provided", async () => {
            let reassignedTo: string | undefined;
            const movedCards: any[] = [];
            let transactionCalled = false;

            const origTransaction = prisma.$transaction;
            const origIssueFindMany = prisma.issues.findMany;
            const origBroadcastCardMoved = wsBroadcaster.broadcastCardMoved;

            prisma.$transaction = mock(async (cb: any) => {
                transactionCalled = true;
                return cb(prisma);
            }) as any;

            wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) => {
                movedCards.push({ boardId, payload });
                return Promise.resolve(true);
            }) as any;

            prisma.sections.findUnique = mock((args: any) => {
                if (args.where.id === validSectionId) {
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

            prisma.issues.updateMany = mock((args: any) => {
                reassignedTo = args.data.sectionId;
                return Promise.resolve({ count: 2 });
            }) as any;

            prisma.sections.delete = mock(() => Promise.resolve({
                id: validSectionId,
                title: "To Delete"
            })) as any;

            try {
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
            } finally {
                prisma.$transaction = origTransaction;
                prisma.issues.findMany = origIssueFindMany;
                wsBroadcaster.broadcastCardMoved = origBroadcastCardMoved;
            }
        });

        it("deletes empty section without requiring targetSectionId", async () => {
            const origTransaction = prisma.$transaction;
            let transactionCalled = false;
            prisma.$transaction = mock(async (cb: any) => {
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

            try {
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
            } finally {
                prisma.$transaction = origTransaction;
            }
        });
    });

    describe("renameSection position persistence", () => {
        const origSectionFindUnique = prisma.sections.findUnique;
        const origSectionUpdate = prisma.sections.update;

        afterEach(() => {
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.sections.update = origSectionUpdate;
        });

        it("persists position when position is provided", async () => {
            let savedData: any;

            prisma.sections.findUnique = mock(() => Promise.resolve({
                title: "Existing Title",
                board: {
                    org: {
                        members: [{ userId, role: "admin" }]
                    }
                }
            })) as any;

            prisma.sections.update = mock((args: any) => {
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

    describe("updateIssue position persistence and broadcasting", () => {
        const validIssueId = "66666666-6666-4666-8666-666666666666";
        const origIssueFindUnique = prisma.issues.findUnique;
        const origSectionFindUnique = prisma.sections.findUnique;
        const origIssueUpdate = prisma.issues.update;
        const origBroadcastCardMoved = wsBroadcaster.broadcastCardMoved;
        const origBroadcastCardUpdated = wsBroadcaster.broadcastCardUpdated;

        afterEach(() => {
            prisma.issues.findUnique = origIssueFindUnique;
            prisma.sections.findUnique = origSectionFindUnique;
            prisma.issues.update = origIssueUpdate;
            wsBroadcaster.broadcastCardMoved = origBroadcastCardMoved;
            wsBroadcaster.broadcastCardUpdated = origBroadcastCardUpdated;
        });

        it("persists position to database and broadcasts card:moved", async () => {
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

            prisma.issues.update = mock((args: any) => {
                updateArgs = args;
                return Promise.resolve({
                    id: validIssueId,
                    boardId: validBoardId,
                    sectionId: validSectionId,
                    position: args.data.position
                });
            }) as any;

            wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) => {
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

        it("persists section move with position and broadcasts card:moved", async () => {
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

            prisma.issues.update = mock((args: any) => {
                updateArgs = args;
                return Promise.resolve({
                    id: validIssueId,
                    boardId: validBoardId,
                    sectionId: validTargetSectionId,
                    position: args.data.position
                });
            }) as any;

            wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) => {
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
});
