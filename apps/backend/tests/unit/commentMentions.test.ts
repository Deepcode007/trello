import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { addComment } from "../../src/controllers/comments/addComment";
import { editComment } from "../../src/controllers/comments/editComment";
import { deleteComment } from "../../src/controllers/comments/deleteComment";
import { wsBroadcaster } from "../../src/services/broadcaster";

describe("Phase 6: Backend Comment Mentions & Lifecycle Unit Tests", () => {
    const authorId = "00000000-0000-4000-8000-000000000000";
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const userOutsideOrg = "99999999-9999-4999-8999-999999999999";
    const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const boardId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const issueId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const commentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

    let createdMentions: any[] = [];
    let deletedMentions: any[] = [];
    let createdNotifications: any[] = [];
    let deletedNotifications: any[] = [];
    let notifiedUsers: Array<{ userId: string; event: any }> = [];

    const originalIssues = (prisma as any).issues;
    const originalComments = (prisma as any).comments;
    const originalMembership = (prisma as any).membership;
    const originalNotifications = (prisma as any).notifications;
    const originalMentions = (prisma as any).mentions;
    const originalExecuteWithOutbox = wsBroadcaster.executeWithOutbox;
    const originalNotifyUser = wsBroadcaster.notifyUser;

    beforeEach(() => {
        createdMentions = [];
        deletedMentions = [];
        createdNotifications = [];
        deletedNotifications = [];
        notifiedUsers = [];

        // Mock wsBroadcaster.executeWithOutbox to execute the tx callback with mock tx
        (wsBroadcaster as any).executeWithOutbox = mock(async (_boardId: string, _eventResolver: any, op: any) => {
            const mockTx = {
                comments: {
                    create: mock(async (args: any) => ({
                        id: commentId,
                        ...args.data,
                        createdAt: new Date(),
                        deletedAt: null
                    })),
                    updateMany: mock(async () => ({ count: 1 })),
                    findUnique: mock(async () => ({
                        id: commentId,
                        description: "updated",
                        createdAt: new Date(),
                        deletedAt: null
                    }))
                },
                mentions: {
                    createMany: mock(async (args: any) => {
                        createdMentions.push(...args.data);
                        return { count: args.data.length };
                    }),
                    deleteMany: mock(async (args: any) => {
                        deletedMentions.push(args.where);
                        return { count: 1 };
                    })
                },
                notifications: {
                    create: mock(async (args: any) => {
                        const notif = {
                            id: `notif-${createdNotifications.length + 1}`,
                            ...args.data,
                            read: false,
                            createdAt: new Date()
                        };
                        createdNotifications.push(notif);
                        return notif;
                    }),
                    findMany: mock(async () => {
                        return createdNotifications.filter(n => !n.read);
                    }),
                    deleteMany: mock(async (args: any) => {
                        deletedNotifications.push(args.where);
                        return { count: 1 };
                    })
                },
                membership: {
                    findMany: mock(async ({ where }: any) => {
                        const ids: string[] = where.userId.in;
                        const results: any[] = [];
                        if (where.orgId === orgId && where.accepted === true) {
                            if (ids.includes(userA)) {
                                results.push({ userId: userA, user: { id: userA, username: "alice", name: "Alice" } });
                            }
                            if (ids.includes(userB)) {
                                results.push({ userId: userB, user: { id: userB, username: "bob", name: "Bob" } });
                            }
                        }
                        return results;
                    })
                }
            };

            const result = await op(mockTx);
            return { result, events: [] };
        });

        (wsBroadcaster as any).notifyUser = mock(async (userId: string, event: any) => {
            notifiedUsers.push({ userId, event });
            return true;
        });

        // Mock base prisma queries
        (prisma as any).issues = {
            findUnique: mock(async () => ({
                id: issueId,
                title: "Fix frontend tests",
                comments: [],
                board: {
                    id: boardId,
                    title: "Engineering Board",
                    orgId,
                    org: {
                        id: orgId,
                        name: "Acme Corp",
                        members: [
                            {
                                role: "admin",
                                user: { id: authorId, name: "Author", username: "author" }
                            }
                        ]
                    }
                }
            }))
        };
    });

    afterEach(() => {
        (prisma as any).issues = originalIssues;
        (prisma as any).comments = originalComments;
        (prisma as any).membership = originalMembership;
        (prisma as any).notifications = originalNotifications;
        (prisma as any).mentions = originalMentions;
        (wsBroadcaster as any).executeWithOutbox = originalExecuteWithOutbox;
        (wsBroadcaster as any).notifyUser = originalNotifyUser;
    });

    describe("addComment() with Mentions", () => {
        it("1. creates comment without mentions and generates no mention notifications", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: "Plain comment without mentions" }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(0);
            expect(createdNotifications).toHaveLength(0);
            expect(notifiedUsers).toHaveLength(0);
        });

        it("2. creates comment with one valid mention and generates persistent notification and WS dispatch", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: `Hey @[Alice](user:${userA}), please review this card.` }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(1);
            expect(createdMentions[0]).toEqual({ commentId, userId: userA });

            expect(createdNotifications).toHaveLength(1);
            expect(createdNotifications[0].recipientId).toBe(userA);
            expect(createdNotifications[0].type).toBe("mention:comment");
            expect(createdNotifications[0].data.issueTitle).toBe("Fix frontend tests");
            expect(createdNotifications[0].data.cardTitle).toBe("Fix frontend tests");
            expect(createdNotifications[0].data.boardId).toBe(boardId);

            expect(notifiedUsers).toHaveLength(1);
            expect(notifiedUsers[0]!.userId).toBe(userA);
            expect(notifiedUsers[0]!.event.type).toBe("user:notification");
            expect(notifiedUsers[0]!.event.payload.notification.type).toBe("mention:comment");
        });

        it("3. creates comment with multiple valid mentions and notifies all recipients", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: `Hey @[Alice](user:${userA}) and @[Bob](user:${userB}), sync on this.` }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(2);
            expect(createdNotifications).toHaveLength(2);
            expect(notifiedUsers.map(n => n.userId)).toEqual([userA, userB]);
        });

        it("4. rejects/ignores invalid user mention markup gracefully", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: "Invalid @[incomplete] and @randomUser without markup format" }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(0);
            expect(createdNotifications).toHaveLength(0);
        });

        it("5. rejects mentions for users outside the organization", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: `Hello @[Intruder](user:${userOutsideOrg}), you should not be notified.` }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(0);
            expect(createdNotifications).toHaveLength(0);
            expect(notifiedUsers).toHaveLength(0);
        });

        it("6. deduplicates duplicate mentions of the same user in one comment", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: `Hey @[Alice](user:${userA}) and @[Alice Smith](user:${userA}), check this!` }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(1);
            expect(createdNotifications).toHaveLength(1);
            expect(notifiedUsers).toHaveLength(1);
        });

        it("7. ignores self-mentions by comment author", async () => {
            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: `Note to @[Myself](user:${authorId}): review this later.` }
            };
            const res = createMockRes();

            await addComment(req, res);

            expect(res.statusCode).toBe(201);
            expect(createdMentions).toHaveLength(0);
            expect(createdNotifications).toHaveLength(0);
            expect(notifiedUsers).toHaveLength(0);
        });
    });

    describe("editComment() with Mention Diffing", () => {
        beforeEach(() => {
            (prisma as any).comments = {
                findUnique: mock(async () => ({
                    id: commentId,
                    description: `Hello @[Alice](user:${userA})`,
                    createdAt: new Date(),
                    deletedAt: null,
                    userId: authorId,
                    mentions: [{ userId: userA }],
                    issue: {
                        id: issueId,
                        title: "Fix frontend tests",
                        board: {
                            id: boardId,
                            title: "Engineering Board",
                            orgId,
                            org: {
                                id: orgId,
                                name: "Acme Corp",
                                members: [
                                    {
                                        role: "admin",
                                        user: { id: authorId, name: "Author", username: "author" }
                                    }
                                ]
                            }
                        }
                    }
                }))
            };
        });

        it("8. edit adds a new mention and creates notification for the newly mentioned user", async () => {
            const req: any = {
                id: authorId,
                params: { commentId },
                body: { description: `Hello @[Alice](user:${userA}) and @[Bob](user:${userB})` }
            };
            const res = createMockRes();

            await editComment(req, res);

            expect(res.statusCode).toBe(200);
            // Bob was added!
            expect(createdMentions).toHaveLength(1);
            expect(createdMentions[0].userId).toBe(userB);

            // Alice was NOT re-notified; only Bob is notified
            expect(createdNotifications).toHaveLength(1);
            expect(createdNotifications[0].recipientId).toBe(userB);
            expect(notifiedUsers).toHaveLength(1);
            expect(notifiedUsers[0]!.userId).toBe(userB);
        });

        it("9. edit removes an existing mention and deletes mention record and unread notification", async () => {
            // Seed an unread notification for Alice
            createdNotifications.push({
                id: "notif-alice-1",
                recipientId: userA,
                type: "mention:comment",
                data: { commentId },
                read: false
            });

            const req: any = {
                id: authorId,
                params: { commentId },
                body: { description: "Hello everyone without mentions" }
            };
            const res = createMockRes();

            await editComment(req, res);

            expect(res.statusCode).toBe(200);
            expect(deletedMentions).toHaveLength(1);
            expect(deletedMentions[0]).toEqual({ commentId, userId: { in: [userA] } });
            expect(deletedNotifications).toHaveLength(1);
            expect(createdNotifications).toHaveLength(1); // No new notifications
            expect(notifiedUsers).toHaveLength(0);
        });

        it("10. edit does not re-notify unchanged mentions", async () => {
            const req: any = {
                id: authorId,
                params: { commentId },
                body: { description: `Updated text but still @[Alice](user:${userA})` }
            };
            const res = createMockRes();

            await editComment(req, res);

            expect(res.statusCode).toBe(200);
            expect(createdMentions).toHaveLength(0);
            expect(createdNotifications).toHaveLength(0);
            expect(deletedMentions).toHaveLength(0);
            expect(notifiedUsers).toHaveLength(0);
        });
    });

    describe("deleteComment() with Mentions", () => {
        beforeEach(() => {
            (prisma as any).comments = {
                findUnique: mock(async () => ({
                    id: commentId,
                    createdAt: new Date(),
                    deletedAt: null,
                    userId: authorId,
                    parentId: null,
                    issue: {
                        id: issueId,
                        board: {
                            id: boardId,
                            org: {
                                members: [{ role: "admin", userId: authorId }]
                            }
                        }
                    }
                }))
            };
        });

        it("11. soft-deletes comment and prunes unread mention notifications without hard deleting", async () => {
            createdNotifications.push({
                id: "notif-to-prune",
                recipientId: userA,
                type: "mention:comment",
                data: { commentId },
                read: false
            });

            const req: any = {
                id: authorId,
                params: { commentId }
            };
            const res = createMockRes();

            await deleteComment(req, res);

            expect(res.statusCode).toBe(200);
            expect(deletedNotifications).toHaveLength(1);
            expect(deletedNotifications[0]).toEqual({ id: { in: ["notif-to-prune"] } });
        });
    });

    describe("Transaction Consistency", () => {
        it("12. transaction rollback does not leave partial mention state or dispatch notifications", async () => {
            (wsBroadcaster as any).executeWithOutbox = mock(async () => {
                throw new Error("Simulated database failure during transaction");
            });

            const req: any = {
                id: authorId,
                params: { issueId },
                body: { description: `Hey @[Alice](user:${userA})` }
            };
            const res = createMockRes();

            expect(addComment(req, res)).rejects.toThrow("Simulated database failure during transaction");
            expect(notifiedUsers).toHaveLength(0);
        });
    });
});
