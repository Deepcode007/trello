import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";

export function create_board_test()
{
    let orgId: string, token: string;
    beforeAll(async () =>
    {
        const user = await create_user();
        token = await login_user(user.email, user.password);

        const org = await create_org(token, `Org_name:${Math.random() * 12}`);
        orgId = org.id;
    })

    it("Fails if user not member", async () =>
    {
        const user1 = await create_user();
        const tkn = await login_user(user1.email, user1.password);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/boards`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
            body: JSON.stringify({ title: `Board_name:${crypto.randomUUID()}` })
        })

        expect(res.status).toBe(403);
    })


    it("Fails if user not employee/admin", async () =>
    {
        const user1 = await create_user();
        const tkn = await login_user(user1.email, user1.password);

        // contributor
        await invite_user(orgId, user1.email, token);
        await accept_invite(tkn, orgId);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/boards`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
            body: JSON.stringify({ title: `Board_name:${crypto.randomUUID()}` })
        })

        expect(res.status).toBe(403);
    })

    it("Creates a board by employee", async () =>
    {
        const user1 = await create_user();
        const tkn = await login_user(user1.email, user1.password);

        // contributor
        await invite_user(orgId, user1.email, token);
        await accept_invite(tkn, orgId);
        await update_user_role(orgId, user1.email, token, "employee");

        const new_name = `Board_name: ${crypto.randomUUID()}`;
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/boards`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
            body: JSON.stringify({ title: new_name })
        })

        expect(res.status).toBe(201);
        const body = await res.json() as {
            success: false;
            error: string;
        } | {
            success: true,
            data: {
                orgId: string;
                title: string;
                id: string;
            }
        };

        if (body.success)
        {
            expect(body.data.title).toBe(new_name);
        }
        
        expect(body.success).toBe(true);
    })
}
