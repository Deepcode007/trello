import { describe, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";
import { create_boards } from "../helpers/create_board";
import { updateRoleHandler } from "../../src/controllers/organisation/updateRole";
import { wsBroadcaster } from "../../src/services/broadcaster";

describe("Organization Role Concurrency Tests", () =>
{
    it("serializes two attempts to demote the only two admins", async () =>
    {
        const adminA = await create_user();
        const tokenA = await login_user(adminA.email, adminA.password);

        const adminB = await create_user();
        const tokenB = await login_user(adminB.email, adminB.password);

        const org = await create_org(tokenA, `role-race-${crypto.randomUUID()}`);
        await invite_user(org.id, adminB.email, tokenA);
        await accept_invite(tokenB, org.id);
        await update_user_role(org.id, adminB.email, tokenA, "admin");

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
    });

    it("allocates increasing outbox sequences using the PostgreSQL advisory lock", async () =>
    {
        const user = await create_user();
        const token = await login_user(user.email, user.password);
        const org = await create_org(token, `outbox-lock-${crypto.randomUUID()}`);
        const board = await create_boards(token, org.id);

        const first = await wsBroadcaster.recordBoardEvent(board!.id, "test:first", { index: 1 }, { throwOnError: true });
        const second = await wsBroadcaster.recordBoardEvent(board!.id, "test:second", { index: 2 }, { throwOnError: true });

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(second!.sequence).toBe(first!.sequence + 1n);
    });
});
