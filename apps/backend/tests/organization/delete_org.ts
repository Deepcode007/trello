import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";

export function delete_org()
{
    let uId: string, token: string, org_id: string;
    beforeAll(async () =>
    {
        let user = await create_user();
        uId = user.id;

        token = await login_user(user.email, user.password);
        let org = await create_org(token, `Random_org${Math.random() * 100 + Math.random() * 10}`, true);
        org_id = org.id;
    })


    it("fails on invalid org id", async () =>
    {
        let res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${crypto.randomUUID()}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(404);
    })

    it("fails if user not admin", async () =>
    {
        let user = await create_user();
        let tkn = await login_user(user.email, user.password);

        await invite_user(org_id, user.email, token);
        await accept_invite(tkn, org_id);

        let res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
        })

        // Forbidden
        expect(res.status).toBe(403);
    })

    it("deletes when admin requests", async () =>
    {
        let res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200);
    })
}
