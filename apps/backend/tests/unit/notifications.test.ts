import { describe, expect, it, mock, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { getNotifications } from "../../src/controllers/notifications/getNotifications";
import { getUnreadCount } from "../../src/controllers/notifications/getUnreadCount";
import { markAsRead } from "../../src/controllers/notifications/markAsRead";
import { markAllAsRead } from "../../src/controllers/notifications/markAllAsRead";
import { createNotification, createBulkNotifications } from "../../src/services/notificationService";
import { Forbidden, Not_Found, Unauthorised, ValidationError } from "../../src/helpers/errorClass";

describe("Notifications Backend Infrastructure & CRUD Suite", () => {
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const notificationId1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const notificationId2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const notificationId3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

    const originalNotifications = (prisma as any).notifications;

    afterEach(() => {
        (prisma as any).notifications = originalNotifications;
    });

    describe("Notification Service (Persistence Layer)", () => {
        it("createNotification creates a record with read=false", async () => {
            const mockCreate = mock(async (args: any) => ({
                id: notificationId1,
                ...args.data,
                createdAt: new Date()
            }));
            (prisma as any).notifications = { create: mockCreate };

            const record = await createNotification({
                recipientId: userA,
                type: "org:invitation_received",
                data: { orgName: "Acme Corp" }
            });

            expect(mockCreate).toHaveBeenCalled();
            expect(record.recipientId).toBe(userA);
            expect(record.type).toBe("org:invitation_received");
            expect(record.read).toBe(false);
            expect(record.data).toEqual({ orgName: "Acme Corp" });
        });

        it("createBulkNotifications handles multiple notifications", async () => {
            const mockCreateManyAndReturn = mock(async (args: any) =>
                args.data.map((d: any, idx: number) => ({
                    id: `bulk-${idx}`,
                    ...d,
                    createdAt: new Date()
                }))
            );
            (prisma as any).notifications = { createManyAndReturn: mockCreateManyAndReturn };

            const items = [
                { recipientId: userA, type: "mention:comment", data: { text: "hi" } },
                { recipientId: userB, type: "org:role_changed", data: { role: "admin" } }
            ];

            const records = await createBulkNotifications(items);
            expect(records).toHaveLength(2);
            expect(records[0]!.recipientId).toBe(userA);
            expect(records[1]!.recipientId).toBe(userB);
        });

        it("createBulkNotifications returns empty array for empty items", async () => {
            expect(await createBulkNotifications([])).toEqual([]);
        });
    });

    describe("GET /api/notifications (getNotifications)", () => {
        it("requires authentication (throws Unauthorised if req.id missing)", async () => {
            const req: any = { query: {} };
            const res = createMockRes();

            expect(getNotifications(req, res)).rejects.toBeInstanceOf(Unauthorised);
        });

        it("retrieves only the current authenticated user's notifications", async () => {
            const mockFindMany = mock(async ({ where }: any) => {
                expect(where.recipientId).toBe(userA);
                return [
                    { id: notificationId1, recipientId: userA, type: "mention:comment", read: false, createdAt: new Date() }
                ];
            });
            (prisma as any).notifications = { findMany: mockFindMany };

            const req: any = { id: userA, query: {} };
            const res = createMockRes();

            await getNotifications(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.notifications).toHaveLength(1);
            expect(res.body.data.notifications[0].recipientId).toBe(userA);
            expect(res.body.data.nextCursor).toBeNull();
        });

        it("handles cursor-based pagination and returns nextCursor when more records exist", async () => {
            const mockFindMany = mock(async ({ take, skip, cursor }: any) => {
                expect(take).toBe(3); // limit(2) + 1
                return [
                    { id: notificationId1, recipientId: userA, createdAt: new Date(3000) },
                    { id: notificationId2, recipientId: userA, createdAt: new Date(2000) },
                    { id: notificationId3, recipientId: userA, createdAt: new Date(1000) }
                ];
            });
            (prisma as any).notifications = { findMany: mockFindMany };

            const req: any = { id: userA, query: { limit: "2" } };
            const res = createMockRes();

            await getNotifications(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.notifications).toHaveLength(2);
            expect(res.body.data.notifications[0].id).toBe(notificationId1);
            expect(res.body.data.notifications[1].id).toBe(notificationId2);
            expect(res.body.data.nextCursor).toBe(notificationId2);
        });

        it("passes cursor and skip when cursor query param is provided", async () => {
            const mockFindMany = mock(async ({ cursor, skip }: any) => {
                expect(cursor).toEqual({ id: notificationId1 });
                expect(skip).toBe(1);
                return [
                    { id: notificationId2, recipientId: userA, createdAt: new Date(2000) }
                ];
            });
            (prisma as any).notifications = { findMany: mockFindMany };

            const req: any = { id: userA, query: { cursor: notificationId1, limit: "10" } };
            const res = createMockRes();

            await getNotifications(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.notifications).toHaveLength(1);
            expect(res.body.data.nextCursor).toBeNull();
        });

        it("throws ValidationError on invalid limit parameter", async () => {
            const req: any = { id: userA, query: { limit: "invalid" } };
            const res = createMockRes();

            expect(getNotifications(req, res)).rejects.toBeInstanceOf(ValidationError);
        });
    });

    describe("GET /api/notifications/unread-count (getUnreadCount)", () => {
        it("requires authentication", async () => {
            const req: any = {};
            const res = createMockRes();
            expect(getUnreadCount(req, res)).rejects.toBeInstanceOf(Unauthorised);
        });

        it("returns the accurate unread count for the authenticated user", async () => {
            const mockCount = mock(async ({ where }: any) => {
                expect(where.recipientId).toBe(userA);
                expect(where.read).toBe(false);
                return 5;
            });
            (prisma as any).notifications = { count: mockCount };

            const req: any = { id: userA };
            const res = createMockRes();

            await getUnreadCount(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.count).toBe(5);
            expect(res.body.count).toBe(5);
        });
    });

    describe("PATCH /api/notifications/:notificationId/read (markAsRead)", () => {
        it("requires authentication", async () => {
            const req: any = { params: { notificationId: notificationId1 } };
            const res = createMockRes();
            expect(markAsRead(req, res)).rejects.toBeInstanceOf(Unauthorised);
        });

        it("throws ValidationError for non-UUID notificationId", async () => {
            const req: any = { id: userA, params: { notificationId: "not-a-uuid" } };
            const res = createMockRes();
            expect(markAsRead(req, res)).rejects.toBeInstanceOf(ValidationError);
        });

        it("throws Not_Found when notification does not exist", async () => {
            (prisma as any).notifications = {
                findUnique: mock(async () => null)
            };

            const req: any = { id: userA, params: { notificationId: notificationId1 } };
            const res = createMockRes();

            expect(markAsRead(req, res)).rejects.toBeInstanceOf(Not_Found);
        });

        it("throws Forbidden when attempting to mark another user's notification", async () => {
            (prisma as any).notifications = {
                findUnique: mock(async () => ({
                    id: notificationId1,
                    recipientId: userB,
                    read: false
                }))
            };

            const req: any = { id: userA, params: { notificationId: notificationId1 } };
            const res = createMockRes();

            expect(markAsRead(req, res)).rejects.toBeInstanceOf(Forbidden);
        });

        it("marks the notification as read successfully", async () => {
            const mockUpdate = mock(async ({ where, data }: any) => {
                expect(where.id).toBe(notificationId1);
                expect(data.read).toBe(true);
                return { id: notificationId1, read: true };
            });
            (prisma as any).notifications = {
                findUnique: mock(async () => ({
                    id: notificationId1,
                    recipientId: userA,
                    read: false
                })),
                update: mockUpdate
            };

            const req: any = { id: userA, params: { notificationId: notificationId1 } };
            const res = createMockRes();

            await markAsRead(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockUpdate).toHaveBeenCalled();
        });
    });

    describe("PATCH /api/notifications/read-all (markAllAsRead)", () => {
        it("requires authentication", async () => {
            const req: any = {};
            const res = createMockRes();
            expect(markAllAsRead(req, res)).rejects.toBeInstanceOf(Unauthorised);
        });

        it("marks all unread notifications for current user as read", async () => {
            const mockUpdateMany = mock(async ({ where, data }: any) => {
                expect(where.recipientId).toBe(userA);
                expect(where.read).toBe(false);
                expect(data.read).toBe(true);
                return { count: 4 };
            });
            (prisma as any).notifications = { updateMany: mockUpdateMany };

            const req: any = { id: userA };
            const res = createMockRes();

            await markAllAsRead(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.count).toBe(4);
            expect(res.body.count).toBe(4);
        });
    });
});
