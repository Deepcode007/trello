import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { inviteUserHandler } from "../../src/controllers/organisation/addUser";
import { acceptInviteHandler } from "../../src/controllers/organisation/acceptInvite";
import { updateRoleHandler } from "../../src/controllers/organisation/updateRole";
import { deleteUserHandler } from "../../src/controllers/organisation/removeUser";
import { wsBroadcaster } from "../../src/services/broadcaster";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../src/helpers/errorClass";

describe("Phase 2: Org Membership Events & Notifications Suite", () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const orgName = "Acme Global";
    const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const admin2Id = "aaaaaaaa-bbbb-4aaa-8aaa-bbbbbbbbbbbb";
    const employeeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const targetUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const targetEmail = "invited@example.com";

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

    // -----------------------------------------------------------------
    // 1. addUser Tests
    // -----------------------------------------------------------------
    describe("1. addUser (inviteUserHandler)", () => {
        let createdNotifications: any[] = [];
        let createdMemberships: any[] = [];
        let notifyUserCalls: any[] = [];
        let advisoryLockAcquired = false;

        const origTransaction = prisma.$transaction;
        const origNotifyUser = wsBroadcaster.notifyUser;

        beforeEach(() => {
            createdNotifications = [];
            createdMemberships = [];
            notifyUserCalls = [];
            advisoryLockAcquired = false;

            wsBroadcaster.notifyUser = mock(async (uid: string, event: any) => {
                notifyUserCalls.push({ uid, event });
                return true;
            }) as any;

            prisma.$transaction = mock(async (cb: any) => {
                const tx: any = {
                    $queryRaw: mock(async () => {
                        advisoryLockAcquired = true;
                        return [{ locked: 1 }];
                    }),
                    user: {
                        findUnique: mock(async ({ where }: any) => {
                            if (where.email === targetEmail) {
                                return { id: targetUserId, email: targetEmail, name: "Target User", username: "targetuser" };
                            }
                            return null;
                        })
                    },
                    orgs: {
                        findUnique: mock(async () => ({
                            id: orgId,
                            name: orgName,
                            members: [
                                {
                                    userId: adminId,
                                    role: "admin",
                                    accepted: true,
                                    user: { id: adminId, name: "Alice Admin", username: "alice" }
                                }
                            ]
                        }))
                    },
                    membership: {
                        create: mock(async ({ data }: any) => {
                            createdMemberships.push(data);
                            return { id: "mem-1", ...data };
                        })
                    },
                    notifications: {
                        create: mock(async ({ data }: any) => {
                            const rec = { id: `notif-${createdNotifications.length + 1}`, ...data, createdAt: new Date() };
                            createdNotifications.push(rec);
                            return rec;
                        })
                    }
                };
                return cb(tx);
            }) as any;
        });

        afterEach(() => {
            prisma.$transaction = origTransaction;
            wsBroadcaster.notifyUser = origNotifyUser;
        });

        it("invitation creates membership state and persists org:invitation_received notification", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail, role: "employee" }
            };
            const res = createMockRes();

            await inviteUserHandler(req, res);

            expect(res.statusCode).toBe(201);
            expect(advisoryLockAcquired).toBe(true);
            expect(createdMemberships).toHaveLength(1);
            expect(createdMemberships[0]).toEqual({
                userId: targetUserId,
                orgId,
                role: "employee",
                accepted: false
            });

            expect(createdNotifications).toHaveLength(1);
            expect(createdNotifications[0].recipientId).toBe(targetUserId);
            expect(createdNotifications[0].type).toBe("org:invitation_received");
            expect(createdNotifications[0].data).toEqual({
                orgId,
                orgName,
                invitedBy: adminId,
                invitedByName: "Alice Admin",
                role: "employee"
            });
        });

        it("dispatches realtime notification IPC to invited user after commit", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await inviteUserHandler(req, res);

            expect(res.statusCode).toBe(201);
            expect(notifyUserCalls).toHaveLength(1);
            expect(notifyUserCalls[0].uid).toBe(targetUserId);
            expect(notifyUserCalls[0].event.type).toBe("user:notification");
            expect(notifyUserCalls[0].event.payload.notification.type).toBe("org:invitation_received");
            expect(notifyUserCalls[0].event.payload.notification.data.orgId).toBe(orgId);
        });

        it("does not create notification if transaction fails / rolls back", async () => {
            prisma.$transaction = mock(async () => {
                throw new Error("Simulated DB failure during transaction");
            }) as any;

            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await expect(inviteUserHandler(req, res)).rejects.toThrow("Simulated DB failure");
            expect(createdNotifications).toHaveLength(0);
            expect(notifyUserCalls).toHaveLength(0);
        });

        it("rejects unauthorized invitation when caller is not an admin", async () => {
            const req: any = {
                id: employeeId, // Not an admin
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await expect(inviteUserHandler(req, res)).rejects.toBeInstanceOf(Forbidden);
            expect(createdNotifications).toHaveLength(0);
            expect(notifyUserCalls).toHaveLength(0);
        });

        it("preserves Phase 1 role validation (defaults to contributor, rejects invalid)", async () => {
            const reqDefault: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const resDefault = createMockRes();
            await inviteUserHandler(reqDefault, resDefault);
            expect(createdMemberships[0].role).toBe("contributor");

            const reqInvalid: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail, role: "superadmin" }
            };
            const resInvalid = createMockRes();
            await expect(inviteUserHandler(reqInvalid, resInvalid)).rejects.toBeInstanceOf(ValidationError);
        });
    });

    // -----------------------------------------------------------------
    // 2. acceptInvite Tests
    // -----------------------------------------------------------------
    describe("2. acceptInvite (acceptInviteHandler)", () => {
        let createdNotifications: any[] = [];
        let notifyUsersCalls: any[] = [];
        let updatedMembership: any = null;
        let advisoryLockAcquired = false;

        const origTransaction = prisma.$transaction;
        const origNotifyUsers = wsBroadcaster.notifyUsers;

        beforeEach(() => {
            createdNotifications = [];
            notifyUsersCalls = [];
            updatedMembership = null;
            advisoryLockAcquired = false;

            wsBroadcaster.notifyUsers = mock(async (uids: string[], event: any) => {
                notifyUsersCalls.push({ uids, event });
                return true;
            }) as any;

            prisma.$transaction = mock(async (cb: any) => {
                const tx: any = {
                    $queryRaw: mock(async () => {
                        advisoryLockAcquired = true;
                        return [{ locked: 1 }];
                    }),
                    orgs: {
                        findUnique: mock(async () => ({
                            id: orgId,
                            name: orgName,
                            members: [
                                {
                                    userId: targetUserId,
                                    role: "contributor",
                                    accepted: false,
                                    user: { id: targetUserId, name: "Bob Acceptor", username: "bob" }
                                },
                                {
                                    userId: adminId,
                                    role: "admin",
                                    accepted: true,
                                    user: { id: adminId, name: "Alice Admin", username: "alice" }
                                },
                                {
                                    userId: admin2Id,
                                    role: "admin",
                                    accepted: true,
                                    user: { id: admin2Id, name: "Carol Admin", username: "carol" }
                                },
                                {
                                    userId: employeeId,
                                    role: "employee",
                                    accepted: true,
                                    user: { id: employeeId, name: "Dave Employee", username: "dave" }
                                }
                            ]
                        }))
                    },
                    membership: {
                        update: mock(async ({ where, data }: any) => {
                            updatedMembership = { where, data };
                            return { accepted: true };
                        })
                    },
                    notifications: {
                        createManyAndReturn: mock(async ({ data }: any) => {
                            const recs = data.map((d: any, idx: number) => ({
                                id: `bulk-${idx}`,
                                ...d,
                                createdAt: new Date()
                            }));
                            createdNotifications.push(...recs);
                            return recs;
                        })
                    }
                };
                return cb(tx);
            }) as any;
        });

        afterEach(() => {
            prisma.$transaction = origTransaction;
            wsBroadcaster.notifyUsers = origNotifyUsers;
        });

        it("accepts invite, updates membership, and notifies all organization admins", async () => {
            const req: any = {
                id: targetUserId,
                params: { orgId }
            };
            const res = createMockRes();

            await acceptInviteHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(advisoryLockAcquired).toBe(true);
            expect(updatedMembership.data.accepted).toBe(true);

            // Both adminId and admin2Id must receive notifications, employee must NOT
            expect(createdNotifications).toHaveLength(2);
            const recipients = createdNotifications.map(n => n.recipientId);
            expect(recipients).toContain(adminId);
            expect(recipients).toContain(admin2Id);
            expect(recipients).not.toContain(employeeId);
            expect(recipients).not.toContain(targetUserId);

            expect(createdNotifications[0].type).toBe("org:invitation_accepted");
            expect(createdNotifications[0].data).toEqual({
                orgId,
                orgName,
                userId: targetUserId,
                userName: "Bob Acceptor"
            });
        });

        it("dispatches realtime IPC to all org admins only after commit", async () => {
            const req: any = {
                id: targetUserId,
                params: { orgId }
            };
            const res = createMockRes();

            await acceptInviteHandler(req, res);

            expect(notifyUsersCalls).toHaveLength(1);
            expect(notifyUsersCalls[0].uids).toEqual([adminId, admin2Id]);
            expect(notifyUsersCalls[0].event.type).toBe("user:notification");
            expect(notifyUsersCalls[0].event.payload.notification.type).toBe("org:invitation_accepted");
        });

        it("rejects non-invited user and does not create notifications", async () => {
            const req: any = {
                id: "unknown-user-id",
                params: { orgId }
            };
            const res = createMockRes();

            await expect(acceptInviteHandler(req, res)).rejects.toBeInstanceOf(Forbidden);
            expect(createdNotifications).toHaveLength(0);
            expect(notifyUsersCalls).toHaveLength(0);
        });

        it("rejects already accepted member with Duplicate error", async () => {
            // Setup org where targetUser is already accepted
            prisma.$transaction = mock(async (cb: any) => {
                const tx: any = {
                    $queryRaw: mock(async () => [{ locked: 1 }]),
                    orgs: {
                        findUnique: mock(async () => ({
                            id: orgId,
                            name: orgName,
                            members: [
                                { userId: targetUserId, role: "contributor", accepted: true }
                            ]
                        }))
                    }
                };
                return cb(tx);
            }) as any;

            const req: any = {
                id: targetUserId,
                params: { orgId }
            };
            const res = createMockRes();

            await expect(acceptInviteHandler(req, res)).rejects.toBeInstanceOf(Duplicate);
            expect(createdNotifications).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------
    // 3. updateRole Tests
    // -----------------------------------------------------------------
    describe("3. updateRole (updateRoleHandler)", () => {
        let createdNotifications: any[] = [];
        let notifyUserCalls: any[] = [];
        let updateUserRoleCalls: any[] = [];
        let advisoryLockAcquired = false;

        const origTransaction = prisma.$transaction;
        const origNotifyUser = wsBroadcaster.notifyUser;
        const origUpdateUserRole = wsBroadcaster.updateUserRole;

        beforeEach(() => {
            createdNotifications = [];
            notifyUserCalls = [];
            updateUserRoleCalls = [];
            advisoryLockAcquired = false;

            wsBroadcaster.notifyUser = mock(async (uid: string, event: any) => {
                notifyUserCalls.push({ uid, event });
                return true;
            }) as any;

            wsBroadcaster.updateUserRole = mock(async (uid: string, oId: string, role: string) => {
                updateUserRoleCalls.push({ uid, oId, role });
                return true;
            }) as any;

            prisma.$transaction = mock(async (cb: any) => {
                const tx: any = {
                    $queryRaw: mock(async () => {
                        advisoryLockAcquired = true;
                        return [{ locked: 1 }];
                    }),
                    orgs: {
                        findUnique: mock(async () => ({
                            id: orgId,
                            name: orgName,
                            _count: { members: 2 },
                            members: [
                                {
                                    userId: adminId,
                                    role: "admin",
                                    accepted: true,
                                    user: { id: adminId, email: "admin@example.com", name: "Alice Admin", username: "alice" }
                                },
                                {
                                    userId: targetUserId,
                                    role: "contributor",
                                    accepted: true,
                                    user: { id: targetUserId, email: targetEmail, name: "Bob Member", username: "bob" }
                                }
                            ]
                        }))
                    },
                    membership: {
                        update: mock(async () => ({ role: "employee" }))
                    },
                    notifications: {
                        create: mock(async ({ data }: any) => {
                            const rec = { id: `notif-${createdNotifications.length + 1}`, ...data, createdAt: new Date() };
                            createdNotifications.push(rec);
                            return rec;
                        })
                    }
                };
                return cb(tx);
            }) as any;
        });

        afterEach(() => {
            prisma.$transaction = origTransaction;
            wsBroadcaster.notifyUser = origNotifyUser;
            wsBroadcaster.updateUserRole = origUpdateUserRole;
        });

        it("authorized role update persists org:role_changed notification with old and new role", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail, role: "employee" }
            };
            const res = createMockRes();

            await updateRoleHandler(req, res);

            expect(res.statusCode).toBe(201);
            expect(advisoryLockAcquired).toBe(true);
            expect(createdNotifications).toHaveLength(1);
            expect(createdNotifications[0].recipientId).toBe(targetUserId);
            expect(createdNotifications[0].type).toBe("org:role_changed");
            expect(createdNotifications[0].data).toEqual({
                orgId,
                orgName,
                oldRole: "contributor",
                newRole: "employee",
                changedBy: adminId,
                changedByName: "Alice Admin"
            });
        });

        it("dispatches realtime notification IPC and SEC-4 WebSocket role cache update", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail, role: "employee" }
            };
            const res = createMockRes();

            await updateRoleHandler(req, res);

            // Realtime notification to affected user
            expect(notifyUserCalls).toHaveLength(1);
            expect(notifyUserCalls[0].uid).toBe(targetUserId);
            expect(notifyUserCalls[0].event.payload.notification.type).toBe("org:role_changed");

            // SEC-4 WebSocket membership cache update
            expect(updateUserRoleCalls).toHaveLength(1);
            expect(updateUserRoleCalls[0]).toEqual({
                uid: targetUserId,
                oId: orgId,
                role: "employee"
            });
        });

        it("rejects unauthorized role update when requester is not an admin", async () => {
            const req: any = {
                id: employeeId,
                params: { orgId },
                body: { email: targetEmail, role: "admin" }
            };
            const res = createMockRes();

            await expect(updateRoleHandler(req, res)).rejects.toBeInstanceOf(Forbidden);
            expect(createdNotifications).toHaveLength(0);
            expect(notifyUserCalls).toHaveLength(0);
            expect(updateUserRoleCalls).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------
    // 4. removeUser Tests
    // -----------------------------------------------------------------
    describe("4. removeUser (deleteUserHandler)", () => {
        let createdNotifications: any[] = [];
        let deletedMembership = false;
        let notifyUserCalls: any[] = [];
        let evictUserCalls: any[] = [];
        let order: string[] = [];
        let advisoryLockAcquired = false;

        const origTransaction = prisma.$transaction;
        const origNotifyUser = wsBroadcaster.notifyUser;
        const origEvictUser = wsBroadcaster.evictUser;
        const origRetryPendingEvents = wsBroadcaster.retryPendingEvents;
        const origRecordBoardEvent = wsBroadcaster.recordBoardEvent;

        beforeEach(() => {
            createdNotifications = [];
            deletedMembership = false;
            notifyUserCalls = [];
            evictUserCalls = [];
            order = [];
            advisoryLockAcquired = false;

            wsBroadcaster.notifyUser = mock(async (uid: string, event: any) => {
                notifyUserCalls.push({ uid, event });
                return true;
            }) as any;

            wsBroadcaster.evictUser = mock(async (uid: string, oId?: string, bIds?: string[]) => {
                evictUserCalls.push({ uid, oId, bIds });
                return true;
            }) as any;

            wsBroadcaster.retryPendingEvents = mock(async () => 0) as any;
            wsBroadcaster.recordBoardEvent = mock(async () => ({ id: "evt-1", sequence: 1n })) as any;

            prisma.$transaction = mock(async (cb: any) => {
                const tx: any = {
                    $queryRaw: mock(async () => {
                        advisoryLockAcquired = true;
                        return [{ locked: 1 }];
                    }),
                    orgs: {
                        findUnique: mock(async () => ({
                            id: orgId,
                            name: orgName,
                            _count: { members: 1 },
                            members: [
                                {
                                    userId: adminId,
                                    role: "admin",
                                    accepted: true,
                                    user: { id: adminId, email: "admin@example.com", name: "Alice Admin", username: "alice" }
                                },
                                {
                                    userId: targetUserId,
                                    role: "employee",
                                    accepted: true,
                                    user: { id: targetUserId, email: targetEmail, name: "Bob Member", username: "bob" }
                                }
                            ]
                        }))
                    },
                    boards: {
                        findMany: mock(async () => [{ id: "board-1" }, { id: "board-2" }])
                    },
                    notifications: {
                        create: mock(async ({ data }: any) => {
                            order.push("create_notification");
                            const rec = { id: `notif-${createdNotifications.length + 1}`, ...data, createdAt: new Date() };
                            createdNotifications.push(rec);
                            return rec;
                        })
                    },
                    membership: {
                        delete: mock(async () => {
                            order.push("delete_membership");
                            deletedMembership = true;
                            return {};
                        })
                    }
                };
                return cb(tx);
            }) as any;
        });

        afterEach(() => {
            prisma.$transaction = origTransaction;
            wsBroadcaster.notifyUser = origNotifyUser;
            wsBroadcaster.evictUser = origEvictUser;
            wsBroadcaster.retryPendingEvents = origRetryPendingEvents;
            wsBroadcaster.recordBoardEvent = origRecordBoardEvent;
        });

        it("persists org:member_removed notification BEFORE deleting membership", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            expect(res.statusCode).toBe(200);
            expect(advisoryLockAcquired).toBe(true);

            // Crucial architectural requirement: notification created BEFORE membership deletion
            expect(order).toEqual(["create_notification", "delete_membership"]);
            expect(deletedMembership).toBe(true);

            expect(createdNotifications).toHaveLength(1);
            expect(createdNotifications[0].recipientId).toBe(targetUserId);
            expect(createdNotifications[0].type).toBe("org:member_removed");
            expect(createdNotifications[0].data).toEqual({
                orgId,
                orgName,
                removedBy: adminId,
                removedByName: "Alice Admin"
            });
        });

        it("dispatches realtime notification IPC and maintains existing WebSocket eviction", async () => {
            const req: any = {
                id: adminId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await deleteUserHandler(req, res);

            // Realtime notification IPC
            expect(notifyUserCalls).toHaveLength(1);
            expect(notifyUserCalls[0].uid).toBe(targetUserId);
            expect(notifyUserCalls[0].event.payload.notification.type).toBe("org:member_removed");

            // Existing WebSocket eviction
            expect(evictUserCalls).toHaveLength(1);
            expect(evictUserCalls[0].uid).toBe(targetUserId);
            expect(evictUserCalls[0].oId).toBe(orgId);
            expect(evictUserCalls[0].bIds).toEqual(["board-1", "board-2"]);
        });

        it("rejects unauthorized removal when caller lacks admin rights", async () => {
            const req: any = {
                id: employeeId,
                params: { orgId },
                body: { email: targetEmail }
            };
            const res = createMockRes();

            await expect(deleteUserHandler(req, res)).rejects.toBeInstanceOf(Forbidden);
            expect(createdNotifications).toHaveLength(0);
            expect(notifyUserCalls).toHaveLength(0);
            expect(evictUserCalls).toHaveLength(0);
        });
    });
});
