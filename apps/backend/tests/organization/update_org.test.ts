import { beforeAll, describe, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";

export async function update_orgs()
{
    let user_id: string, org_id: string, token: string;
    beforeAll(async() =>
    {
        const user = await create_user();
        token = await login_user(user.email, user.password);

        const org = await create_org(token, `Org_name+${crypto.randomUUID()}`, true);
        org_id = org.id;
    })
    
    it("should not update org if user is not admin", async() =>
    {
        const user2 = await create_user();
        await invite_user(org_id, user2.email, token);
        const tkn = await login_user(user2.email, user2.password);

        // user2 is contributor

        const org = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
            body: JSON.stringify({
                name: "new_name",
                description: "new_desc",
                visible: false
            })
        });

        expect(org.status).toBe(403);
    })

    it("should not update org orgid is invalid", async() =>
    {
        const org = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${crypto.randomUUID()}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
                name: "new_name",
            })
        });

        expect(org.status).toBe(404);
    })

    it("should update the org name", async () =>
    {
        const org = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
                name: "new_name"
            })
        });

        expect(org.status).toBe(200);

        const body = await org.json() as {
            success: true,
            data: {
                description: string;
                id: string;
                name: string;
                visible: boolean;
            }
        };

        expect(body.data.name).toBe("new_name");
    })
}