import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { prisma } from "db/prisma";
import { env } from "../../index";
import { updateRoleHandler } from "../../src/controllers/organisation/updateRole";
import { wsBroadcaster } from "../../src/services/broadcaster";

const enabled = Boolean(env.DATABASE_URL);

describe.skipIf(!enabled)("database-backed organization role concurrency", () =>
{
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    afterAll(async () =>
    {
        if (createdOrgIds.length)
        {
            await prisma.membership.deleteMany({ where: { orgId: { in: createdOrgIds } } });
            await prisma.orgs.deleteMany({ where: { id: { in: createdOrgIds } } });
        }
        if (createdUserIds.length)
        {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
    });

    it("serializes two attempts to demote the only two admins", async () =>
    {
        const suffix = randomUUID();
        const adminA = await prisma.user.create({ data: { email: `admin-a-${suffix}@example.test`, username: `admin-a-${suffix}`, password: "test-only" } });
        createdUserIds.push(adminA.id);
        const adminB = await prisma.user.create({ data: { email: `admin-b-${suffix}@example.test`, username: `admin-b-${suffix}`, password: "test-only" } });
        createdUserIds.push(adminB.id);

        const org = await prisma.orgs.create({ data: { name: `role-race-${suffix}`, description: "integration test" } });
        createdOrgIds.push(org.id);
        await prisma.membership.createMany({
            data: [adminA, adminB].map(user => ({ userId: user.id, orgId: org.id, role: "admin" as const, accepted: true }))
        });

        const invoke = (requesterId: string, targetEmail: string) =>
        {
            const res: any = {
                statusCode: 200,
                status(code: number) { this.statusCode = code; return this; },
                json(body: unknown) { this.body = body; return this; }
            };
            return updateRoleHandler({
                id: requesterId,
                params: { orgId: org.id },
                body: { email: targetEmail, role: "employee" }
            } as any, res).then(() => ({ success: true, res }));
        };

        const outcomes = await Promise.allSettled([
            invoke(adminA.id, adminB.email),
            invoke(adminB.id, adminA.email)
        ]);

        expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
        const remainingAdmins = await prisma.membership.count({ where: { orgId: org.id, role: "admin", accepted: true } });
        expect(remainingAdmins).toBe(1);
    });

    it("allocates increasing outbox sequences using the PostgreSQL advisory lock", async () =>
    {
        const suffix = randomUUID();
        const org = await prisma.orgs.create({
            data: { name: `outbox-lock-${suffix}`, description: "integration test" }
        });
        createdOrgIds.push(org.id);
        const board = await prisma.boards.create({
            data: { title: `outbox-lock-${suffix}`, orgId: org.id }
        });

        const first = await wsBroadcaster.recordBoardEvent(board.id, "test:first", { index: 1 }, { throwOnError: true });
        const second = await wsBroadcaster.recordBoardEvent(board.id, "test:second", { index: 2 }, { throwOnError: true });

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(second!.sequence).toBe(first!.sequence + 1n);
    });
});
