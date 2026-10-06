import { describe, expect, it, mock, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { getAllBoards } from "../../src/controllers/board/getBoards";
import { getBoardDetails } from "../../src/controllers/board/getaBoard";
import { issueDetail } from "../../src/controllers/issues/issueDetail";
import { getAllComments } from "../../src/controllers/comments/getAllcomments";
import { updateRoleHandler } from "../../src/controllers/organisation/updateRole";
import { UpdateOrgHandler } from "../../src/controllers/organisation/updateDetails";
import { inviteUserHandler } from "../../src/controllers/organisation/addUser";
import { deleteComment } from "../../src/controllers/comments/deleteComment";
import { renameBoard } from "../../src/controllers/board/renameBoard";
import { deleteBoard } from "../../src/controllers/board/deleteBoard";
import { addComment } from "../../src/controllers/comments/addComment";
import { wsBroadcaster } from "../../src/services/broadcaster";

describe("Empirical Challenger Verification Suite", () => {
    const validBoardId = "11111111-1111-4111-8111-111111111111";
    const validOrgId = "22222222-2222-4222-8222-222222222222";
    const validIssueId = "33333333-3333-4333-8333-333333333333";
    const validCommentId = "44444444-4444-4444-8444-444444444444";
    const adminUserId = "admin-user-001";
    const normalUserId = "normal-user-002";

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

    // -------------------------------------------------------------
    // Finding API-01 Verification: Board id in Projections
    // -------------------------------------------------------------
    describe("API-01: Board id in getAllBoards and getBoardDetails", () => {
        const origOrgFindUnique = prisma.orgs.findUnique;
        const origBoardFindUnique = prisma.boards.findUnique;
        const origMembershipFindUnique = prisma.membership.findUnique;

        afterEach(() => {
            prisma.orgs.findUnique = origOrgFindUnique;
            prisma.boards.findUnique = origBoardFindUnique;
            prisma.membership.findUnique = origMembershipFindUnique;
        });

        it("getAllBoards query selection explicitly includes id field", async () => {
            let capturedSelect: any = null;
            prisma.orgs.findUnique = mock((args: any) => {
                capturedSelect = args.select;
                return Promise.resolve({
                    id: validOrgId,
                    boards: [
                        { id: validBoardId, title: "Sprint 1", _count: { issues: 5 } }
                    ]
                });
            }) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                userId: adminUserId,
                orgId: validOrgId,
                accepted: true
            })) as any;

            const req: any = { id: adminUserId, params: { orgId: validOrgId } };
            const res = createMockRes();

            await getAllBoards(req, res);

            // Verify select clause includes id
            expect(capturedSelect.boards.select.title).toBe(true);
            expect(capturedSelect.boards.select.id).toBe(true);
            // Verify returned data includes id attribute
            expect(res.body.data[0].id).toBe(validBoardId);
            expect(res.body.data[0].title).toBe("Sprint 1");
        });

        it("getBoardDetails query selection explicitly includes id field", async () => {
            let capturedSelect: any = null;
            prisma.boards.findUnique = mock((args: any) => {
                capturedSelect = args.select;
                return Promise.resolve({
                    id: validBoardId,
                    title: "Architecture Board",
                    section: [],
                    orgId: validOrgId
                });
            }) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                userId: adminUserId,
                orgId: validOrgId,
                accepted: true
            })) as any;

            const req: any = { id: adminUserId, params: { boardId: validBoardId } };
            const res = createMockRes();

            await getBoardDetails(req, res);

            // Verify select clause includes id
            expect(capturedSelect.title).toBe(true);
            expect(capturedSelect.id).toBe(true);
            // Verify returned data includes id attribute
            expect(res.body.data.id).toBe(validBoardId);
            expect(res.body.data.title).toBe("Architecture Board");
        });
    });

    // -------------------------------------------------------------
    // Finding API-02 Verification: 200 on Empty Comments & Auth Order
    // -------------------------------------------------------------
    describe("API-02: getAllComments empty 200 and auth ordering", () => {
        const origFindMany = prisma.comments.findMany;
        const origIssueFindUnique = prisma.issues.findUnique;

        afterEach(() => {
            prisma.comments.findMany = origFindMany;
            prisma.issues.findUnique = origIssueFindUnique;
        });

        it("returns HTTP 200 with empty array when comment list is empty for valid member", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                board: {
                    org: {
                        members: [{ userId: adminUserId, accepted: true }]
                    }
                }
            })) as any;

            prisma.comments.findMany = mock(() => Promise.resolve([])) as any;

            const req: any = { id: adminUserId, params: { issueId: validIssueId } };
            const res = createMockRes();

            await getAllComments(req, res);
            expect(res.statusCode).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it("checks org membership first and rejects unauthorized user with 403 Forbidden even on 0 comments", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                board: {
                    org: {
                        members: [] // Not a member
                    }
                }
            })) as any;

            const req: any = { id: "attacker-user-id", params: { issueId: validIssueId } };
            const res = createMockRes();

            await expect(getAllComments(req, res)).rejects.toThrow("Members only");
        });
    });

    // -------------------------------------------------------------
    // Finding API-03 Verification: Route Param Mismatch in issueDetail
    // -------------------------------------------------------------
    describe("API-03: issueDetail param resolution on :id route", () => {
        const origFindUnique = prisma.issues.findUnique;

        afterEach(() => {
            prisma.issues.findUnique = origFindUnique;
        });

        it("succeeds validation when route param is :id (from /api/cards/:id)", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                title: "Card 1",
                gh_url: null,
                board: {
                    title: "Board 1",
                    id: validBoardId,
                    org: {
                        members: [{ userId: adminUserId, accepted: true }]
                    }
                },
                section: { title: "Todo", id: "sec-1" },
                issueMappings: []
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { id: validIssueId }
            };
            const res = createMockRes();

            await issueDetail(req, res);
            expect(res.statusCode).toBe(200);
            expect(res.body.data.id).toBe(validIssueId);
        });

        it("succeeds validation when req.params.issueId is provided", async () => {
            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                title: "Card 1",
                gh_url: null,
                board: {
                    title: "Board 1",
                    id: validBoardId,
                    org: {
                        members: [{ userId: adminUserId, accepted: true }]
                    }
                },
                section: { title: "Todo", id: "sec-1" },
                issueMappings: []
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId }
            };
            const res = createMockRes();

            await issueDetail(req, res);
            expect(res.statusCode).toBe(200);
            expect(res.body.data.id).toBe(validIssueId);
        });
    });

    // -------------------------------------------------------------
    // Finding API-04 Verification: updateRoleHandler Bugs
    // -------------------------------------------------------------
    describe("API-04: updateRoleHandler self-update deadlock and role truncation", () => {
        const origOrgFindUnique = prisma.orgs.findUnique;
        const origMembershipUpdate = prisma.membership.update;

        afterEach(() => {
            prisma.orgs.findUnique = origOrgFindUnique;
            prisma.membership.update = origMembershipUpdate;
        });

        it("admin updating their own role succeeds without deadlock when multiple admins exist", async () => {
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                _count: { members: 2 },
                members: [
                    {
                        userId: adminUserId,
                        role: "admin",
                        user: { email: "admin@example.com" }
                    },
                    {
                        userId: "other-admin-id",
                        role: "admin",
                        user: { email: "other_admin@example.com" }
                    }
                ]
            })) as any;

            let updatedUserId: any = null;
            prisma.membership.update = mock((args: any) => {
                updatedUserId = args.where.userId_orgId.userId;
                return Promise.resolve({ role: "employee" });
            }) as any;

            // Admin targets own email
            const req: any = {
                id: adminUserId,
                params: { orgId: validOrgId },
                body: { email: "admin@example.com", role: "employee" }
            };
            const res = createMockRes();

            await updateRoleHandler(req, res);
            expect(res.statusCode).toBe(201);
            expect(updatedUserId).toBe(adminUserId);
        });

        it("prevents demoting the last remaining admin", async () => {
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                _count: { members: 1 },
                members: [
                    {
                        userId: adminUserId,
                        role: "admin",
                        user: { email: "admin@example.com" }
                    }
                ]
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { orgId: validOrgId },
                body: { email: "admin@example.com", role: "employee" }
            };
            const res = createMockRes();

            await expect(updateRoleHandler(req, res)).rejects.toThrow("Cannot demote the last remaining admin");
        });

        it("supports role enum 'contributor'", async () => {
            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                _count: { members: 2 },
                members: [
                    {
                        userId: adminUserId,
                        role: "admin",
                        user: { email: "admin@example.com" }
                    },
                    {
                        userId: normalUserId,
                        role: "employee",
                        user: { email: "other@example.com" }
                    }
                ]
            })) as any;

            prisma.membership.update = mock(() => Promise.resolve({ role: "contributor" })) as any;

            const req: any = {
                id: adminUserId,
                params: { orgId: validOrgId },
                body: { email: "other@example.com", role: "contributor" }
            };
            const res = createMockRes();

            await updateRoleHandler(req, res);
            expect(res.statusCode).toBe(201);
        });
    });

    // -------------------------------------------------------------
    // Finding API-05 Verification: Enforcing accepted: true in UpdateOrg
    // -------------------------------------------------------------
    describe("API-05: UpdateOrgHandler unaccepted invitee authorization", () => {
        const origOrgFindUnique = prisma.orgs.findUnique;
        const origOrgUpdate = prisma.orgs.update;

        afterEach(() => {
            prisma.orgs.findUnique = origOrgFindUnique;
            prisma.orgs.update = origOrgUpdate;
        });

        it("verifies query filter enforces accepted: true and rejects unaccepted invitee", async () => {
            let capturedQuery: any = null;
            prisma.orgs.findUnique = mock((args: any) => {
                capturedQuery = args;
                // If query checks accepted: true, it will find 0 members for an unaccepted invitee
                return Promise.resolve({
                    id: validOrgId,
                    members: [] // Not accepted
                });
            }) as any;

            const req: any = {
                id: normalUserId,
                params: { orgId: validOrgId },
                body: { name: "Hijacked Org", description: "New Description" }
            };
            const res = createMockRes();

            await expect(UpdateOrgHandler(req, res)).rejects.toThrow("You do not have permission to modify this organization");
            expect(capturedQuery.select.members.where.accepted).toBe(true);
            expect(capturedQuery.select.members.where.role).toBe("admin");
        });
    });

    // -------------------------------------------------------------
    // Finding API-06 Verification: Additional API Defects
    // -------------------------------------------------------------
    describe("API-06: Additional API defects empirical check", () => {
        const origUserFindUnique = prisma.user.findUnique;
        const origOrgFindUnique = prisma.orgs.findUnique;
        const origMembershipCreate = prisma.membership.create;
        const origCommentFindUnique = prisma.comments.findUnique;
        const origCommentTransaction = prisma.$transaction;

        afterEach(() => {
            prisma.user.findUnique = origUserFindUnique;
            prisma.orgs.findUnique = origOrgFindUnique;
            prisma.membership.create = origMembershipCreate;
            prisma.comments.findUnique = origCommentFindUnique;
            prisma.$transaction = origCommentTransaction;
        });

        it("addUser: admin inviting own email throws Duplicate without 500 duplicate key error", async () => {
            prisma.user.findUnique = mock(() => Promise.resolve({
                id: adminUserId,
                email: "admin@example.com"
            })) as any;

            prisma.orgs.findUnique = mock(() => Promise.resolve({
                id: validOrgId,
                members: [{ userId: adminUserId, role: "admin", accepted: true }]
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { orgId: validOrgId },
                body: { email: "admin@example.com" }
            };
            const res = createMockRes();

            await expect(inviteUserHandler(req, res)).rejects.toThrow("User already member");
        });

        it("deleteComment: admin CAN delete comment older than 24 hours (bypass moderation lockout)", async () => {
            const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
            prisma.comments.findUnique = mock(() => Promise.resolve({
                id: validCommentId,
                createdAt: fortyEightHoursAgo,
                userId: "other-user",
                parentId: null,
                issue: {
                    id: validIssueId,
                    board: {
                        id: validBoardId,
                        org: {
                            members: [{ role: "admin", userId: adminUserId }] // Requester is Admin!
                        }
                    }
                }
            })) as any;

            prisma.$transaction = mock(async (fn: any) => {
                return fn({
                    comments: {
                        updateMany: mock(() => Promise.resolve({ count: 0 })),
                        update: mock(() => Promise.resolve({ id: validCommentId }))
                    }
                });
            }) as any;

            const origBroadcast = wsBroadcaster.broadcast;
            wsBroadcaster.broadcast = mock(() => Promise.resolve(true)) as any;

            const req: any = {
                id: adminUserId,
                params: { commentId: validCommentId }
            };
            const res = createMockRes();

            await deleteComment(req, res);
            expect(res.statusCode).toBe(201);
            expect(res.body.data).toBe(validCommentId);

            wsBroadcaster.broadcast = origBroadcast;
        });
    });

    // -------------------------------------------------------------
    // Finding WS-01 Verification: WebSocket Broadcast Triggers
    // -------------------------------------------------------------
    describe("WS-01: Mutations trigger WebSocket Broadcasts", () => {
        const origBoardFindUnique = prisma.boards.findUnique;
        const origBoardUpdate = prisma.boards.update;
        const origBoardDelete = prisma.boards.delete;
        const origMembershipFindUnique = prisma.membership.findUnique;
        const origIssueFindUnique = prisma.issues.findUnique;
        const origCommentCreate = prisma.comments.create;
        const origBroadcast = wsBroadcaster.broadcast;

        afterEach(() => {
            prisma.boards.findUnique = origBoardFindUnique;
            prisma.boards.update = origBoardUpdate;
            prisma.boards.delete = origBoardDelete;
            prisma.membership.findUnique = origMembershipFindUnique;
            prisma.issues.findUnique = origIssueFindUnique;
            prisma.comments.create = origCommentCreate;
            wsBroadcaster.broadcast = origBroadcast;
        });

        it("renameBoard executes DB mutation and triggers board:updated broadcast", async () => {
            let broadcastCalled = false;
            let capturedEvent: any = null;
            wsBroadcaster.broadcast = mock((boardId: string, event: any) => {
                broadcastCalled = true;
                capturedEvent = event;
                return Promise.resolve(true);
            }) as any;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: {
                    members: [{ userId: adminUserId, accepted: true, role: "admin" }]
                }
            })) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                userId: adminUserId,
                orgId: validOrgId,
                role: "admin",
                accepted: true
            })) as any;

            prisma.boards.update = mock(() => Promise.resolve({
                id: validBoardId,
                title: "New Title"
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId },
                body: { title: "New Title" }
            };
            const res = createMockRes();

            await renameBoard(req, res);

            expect(res.statusCode).toBe(200);
            expect(broadcastCalled).toBe(true);
            expect(capturedEvent.type).toBe("board:updated");
            expect(capturedEvent.payload.title).toBe("New Title");
        });

        it("deleteBoard executes DB delete and triggers board:deleted broadcast", async () => {
            let broadcastCalled = false;
            let capturedEvent: any = null;
            wsBroadcaster.broadcast = mock((boardId: string, event: any) => {
                broadcastCalled = true;
                capturedEvent = event;
                return Promise.resolve(true);
            }) as any;

            prisma.boards.findUnique = mock(() => Promise.resolve({
                id: validBoardId,
                org: { id: validOrgId }
            })) as any;

            prisma.membership.findUnique = mock(() => Promise.resolve({
                userId: adminUserId,
                orgId: validOrgId,
                role: "admin",
                accepted: true
            })) as any;

            prisma.boards.delete = mock(() => Promise.resolve({ id: validBoardId })) as any;

            const req: any = {
                id: adminUserId,
                params: { boardId: validBoardId }
            };
            const res = createMockRes();

            await deleteBoard(req, res);

            expect(res.statusCode).toBe(200);
            expect(broadcastCalled).toBe(true);
            expect(capturedEvent.type).toBe("board:deleted");
            expect(capturedEvent.payload.boardId).toBe(validBoardId);
        });

        it("addComment creates comment in DB and triggers comment:created broadcast", async () => {
            let broadcastCalled = false;
            let capturedEvent: any = null;
            wsBroadcaster.broadcast = mock((boardId: string, event: any) => {
                broadcastCalled = true;
                capturedEvent = event;
                return Promise.resolve(true);
            }) as any;

            prisma.issues.findUnique = mock(() => Promise.resolve({
                id: validIssueId,
                comments: [],
                board: {
                    id: validBoardId,
                    org: {
                        members: [{ userId: adminUserId, accepted: true }]
                    }
                }
            })) as any;

            prisma.comments.create = mock(() => Promise.resolve({
                id: validCommentId,
                description: "New Comment",
                userId: adminUserId,
                issueId: validIssueId
            })) as any;

            const req: any = {
                id: adminUserId,
                params: { issueId: validIssueId },
                body: { description: "New Comment" }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(broadcastCalled).toBe(true);
            expect(capturedEvent.type).toBe("comment:created");
        });
    });
});
