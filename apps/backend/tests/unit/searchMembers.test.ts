import { describe, expect, it, mock, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { searchMembersHandler } from "../../src/controllers/organisation/searchMembers";
import { Forbidden, ValidationError } from "../../src/helpers/errorClass";

describe("Organization Member Search Endpoint Unit Tests", () => {
    const callerId = "00000000-0000-4000-8000-000000000000";
    const nonMemberId = "11111111-1111-4111-8111-111111111111";
    const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const userA = "22222222-2222-4222-8222-222222222222";
    const userB = "33333333-3333-4333-8333-333333333333";

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

    const originalMembership = (prisma as any).membership;

    afterEach(() => {
        (prisma as any).membership = originalMembership;
    });

    it("rejects non-UUID orgId with ValidationError", async () => {
        const req: any = { id: callerId, params: { orgId: "invalid-uuid" }, query: {} };
        const res = createMockRes();

        expect(searchMembersHandler(req, res)).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects non-members with Forbidden", async () => {
        (prisma as any).membership = {
            findUnique: mock(async () => null)
        };

        const req: any = { id: nonMemberId, params: { orgId }, query: { q: "alice" } };
        const res = createMockRes();

        expect(searchMembersHandler(req, res)).rejects.toBeInstanceOf(Forbidden);
    });

    it("searches and returns accepted members matching query", async () => {
        (prisma as any).membership = {
            findUnique: mock(async ({ where }: any) => {
                if (where.userId_orgId?.userId === callerId && where.userId_orgId?.orgId === orgId) {
                    return { userId: callerId, orgId, accepted: true };
                }
                return null;
            }),
            findMany: mock(async ({ where, take }: any) => {
                expect(where.orgId).toBe(orgId);
                expect(where.accepted).toBe(true);
                expect(take).toBe(10);
                return [
                    {
                        user: {
                            id: userA,
                            name: "Alice Smith",
                            username: "alice",
                            avatarUrl: "https://example.com/alice.png"
                        }
                    }
                ];
            })
        };

        const req: any = { id: callerId, params: { orgId }, query: { q: "ali" } };
        const res = createMockRes();

        await searchMembersHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toEqual({
            id: userA,
            name: "Alice Smith",
            username: "alice",
            avatarUrl: "https://example.com/alice.png"
        });
        expect(res.body.members).toHaveLength(1);
    });

    it("respects custom limit clamped to maximum 20", async () => {
        let requestedTake = 0;
        (prisma as any).membership = {
            findUnique: mock(async () => ({ userId: callerId, orgId, accepted: true })),
            findMany: mock(async ({ take }: any) => {
                requestedTake = take;
                return [];
            })
        };

        const req: any = { id: callerId, params: { orgId }, query: { limit: "15" } };
        const res = createMockRes();

        await searchMembersHandler(req, res);
        expect(requestedTake).toBe(15);
    });
});
