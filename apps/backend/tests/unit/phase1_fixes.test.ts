import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { inviteUserHandler } from "../../src/controllers/organisation/addUser";
import { acceptInviteHandler } from "../../src/controllers/organisation/acceptInvite";
import { addComment } from "../../src/controllers/comments/addComment";
import { editComment } from "../../src/controllers/comments/editComment";
import { wsBroadcaster } from "../../src/services/broadcaster";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../src/helpers/errorClass";

describe("Phase 1 Bug & Security Fixes Unit Suite", () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const boardId = "22222222-2222-4222-8222-222222222222";
    const issueId = "33333333-3333-4333-8333-333333333333";
    const commentId = "44444444-4444-4444-8444-444444444444";
    const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const targetUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const targetEmail = "target@example.com";

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

    describe("BUG-2: Invitation role handling in addUser.ts", () => {
        const origUserFindUnique = prisma.user.findUnique;
        const origOrgsFindUnique = prisma.orgs.findUnique;
        const origMembershipCreate = prisma.membership.create;

        afterEach(() => {
            prisma.user.findUnique = origUserFindUnique;
            prisma.orgs.findUnique = origOrgsFindUnique;
            prisma.membership.create = origMembershipCreate;
        });

        it("defaults role to contributor when role is omitted", async () => {
            prisma.user.findUnique = mock(async () => ({ id: targetUserId, email: targetEmail })) as any;
            prisma.orgs.findUnique = mock(async () => ({
                members: [{ userId: adminId, role: "admin", accepted: true }]
            })) as any;

            let createdRole = "";
            prisma.membership.create = mock(async ({ data }: any) => {
                createdRole = data.role;
                return { id: "new-mem", ...data };
            }) as any;

            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await inviteUserHandler(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdRole).toBe("contributor");
        });

        it("accepts and uses a valid role (employee/admin) when provided", async () => {
            prisma.user.findUnique = mock(async () => ({ id: targetUserId, email: targetEmail })) as any;
            prisma.orgs.findUnique = mock(async () => ({
                members: [{ userId: adminId, role: "admin", accepted: true }]
            })) as any;

            let createdRole = "";
            prisma.membership.create = mock(async ({ data }: any) => {
                createdRole = data.role;
                return { id: "new-mem", ...data };
            }) as any;

            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail, role: "employee" }
            };
            const res = createMockRes();

            await inviteUserHandler(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdRole).toBe("employee");
        });

        it("throws ValidationError when an invalid role is provided", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail, role: "superadmin" }
            };
            const res = createMockRes();

            expect(inviteUserHandler(req, res)).rejects.toBeInstanceOf(ValidationError);
        });
    });

    describe("BUG-3: Transaction & Advisory Lock in acceptInvite.ts", () => {
        const origTransaction = prisma.$transaction;

        afterEach(() => {
            prisma.$transaction = origTransaction;
        });

        it("wraps acceptInvite in a transaction and acquires an advisory lock", async () => {
            let advisoryLockCalled = false;
            let updatedAccepted = false;

            const mockTx: any = {
                $queryRaw: mock(async () => {
                    advisoryLockCalled = true;
                    return [{ locked: 1 }];
                }),
                orgs: {
                    findUnique: mock(async () => ({
                        id: orgId,
                        members: [{ userId: targetUserId, accepted: false, role: "contributor" }]
                    }))
                },
                membership: {
                    update: mock(async ({ data }: any) => {
                        updatedAccepted = data.accepted;
                        return { accepted: true };
                    })
                }
            };

            prisma.$transaction = mock(async (cb: any) => cb(mockTx)) as any;

            const req: any = {
                id: targetUserId,
                params: { orgId }
            };
            const res = createMockRes();

            await acceptInviteHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(advisoryLockCalled).toBe(true);
            expect(updatedAccepted).toBe(true);
        });

        it("throws Duplicate if user is already an accepted member", async () => {
            const mockTx: any = {
                $queryRaw: mock(async () => [{ locked: 1 }]),
                orgs: {
                    findUnique: mock(async () => ({
                        id: orgId,
                        members: [{ userId: targetUserId, accepted: true, role: "contributor" }]
                    }))
                }
            };
            prisma.$transaction = mock(async (cb: any) => cb(mockTx)) as any;

            const req: any = {
                id: targetUserId,
                params: { orgId }
            };
            const res = createMockRes();

            expect(acceptInviteHandler(req, res)).rejects.toBeInstanceOf(Duplicate);
        });

        it("throws Forbidden if user was not invited", async () => {
            const mockTx: any = {
                $queryRaw: mock(async () => [{ locked: 1 }]),
                orgs: {
                    findUnique: mock(async () => ({
                        id: orgId,
                        members: []
                    }))
                }
            };
            prisma.$transaction = mock(async (cb: any) => cb(mockTx)) as any;

            const req: any = {
                id: targetUserId,
                params: { orgId }
            };
            const res = createMockRes();

            expect(acceptInviteHandler(req, res)).rejects.toBeInstanceOf(Forbidden);
        });
    });

    describe("SEC-3: Comment length validation (max 10,000 characters)", () => {
        const origIssueFindUnique = prisma.issues.findUnique;
        const origCommentsFindUnique = prisma.comments.findUnique;
        const origExecuteWithOutbox = wsBroadcaster.executeWithOutbox;

        beforeEach(() => {
            wsBroadcaster.executeWithOutbox = mock(async (bId: any, resolver: any, op: any) => {
                const result = await op(prisma);
                return { result, events: [], published: true };
            }) as any;
        });

        afterEach(() => {
            prisma.issues.findUnique = origIssueFindUnique;
            prisma.comments.findUnique = origCommentsFindUnique;
            wsBroadcaster.executeWithOutbox = origExecuteWithOutbox;
        });

        it("addComment rejects comment description exceeding 10,000 characters", async () => {
            const longText = "a".repeat(10001);
            const req: any = {
                id: adminId,
                params: { issueId },
                body: { description: longText }
            };
            const res = createMockRes();

            expect(addComment(req, res)).rejects.toBeInstanceOf(ValidationError);
        });

        it("addComment accepts comment description up to 10,000 characters", async () => {
            const validLongText = "a".repeat(10000);
            prisma.issues.findUnique = mock(async () => ({
                id: issueId,
                comments: [],
                board: {
                    id: boardId,
                    org: {
                        members: [{ userId: adminId, accepted: true }]
                    }
                }
            })) as any;

            const origCommentCreate = prisma.comments.create;
            prisma.comments.create = mock(async ({ data }: any) => ({ id: commentId, ...data })) as any;

            const req: any = {
                id: adminId,
                params: { issueId },
                body: { description: validLongText }
            };
            const res = createMockRes();

            await addComment(req, res);
            expect(res.statusCode).toBe(201);

            prisma.comments.create = origCommentCreate;
        });

        it("editComment rejects description exceeding 10,000 characters", async () => {
            const longText = "b".repeat(10001);
            const req: any = {
                id: adminId,
                params: { commentId },
                body: { description: longText }
            };
            const res = createMockRes();

            expect(editComment(req, res)).rejects.toBeInstanceOf(ValidationError);
        });

        it("editComment accepts description up to 10,000 characters", async () => {
            const validLongText = "b".repeat(10000);
            prisma.comments.findUnique = mock(async () => ({
                id: commentId,
                createdAt: new Date(),
                deletedAt: null,
                userId: adminId,
                issue: {
                    board: {
                        id: boardId,
                        org: {
                            members: [{ userId: adminId, accepted: true }]
                        }
                    }
                }
            })) as any;

            const origUpdateMany = prisma.comments.updateMany;
            const origFindUnique = prisma.comments.findUnique;
            prisma.comments.updateMany = mock(async () => ({ count: 1 })) as any;

            const req: any = {
                id: adminId,
                params: { commentId },
                body: { description: validLongText }
            };
            const res = createMockRes();

            await editComment(req, res);
            expect(res.statusCode).toBe(200);

            prisma.comments.updateMany = origUpdateMany;
            prisma.comments.findUnique = origFindUnique;
        });
    });
});
