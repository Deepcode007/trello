import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";


export function getAllorgs()
{
    let email: string, userid: string, token: string;
    beforeAll(async () =>
    {
        let obj = await create_user();
        if (!obj)
        {
            expect(obj).toBeDefined();
            return;
        }
        email = obj.email
        userid = obj.id
        token = await login_user(email, obj.password)
    })

    it("does not return data with  no token/invalid token", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "authorization": `Bearer d23wdwdwdsffv.wdsafsdfDdweDwed.adsfWdeeDwed` },
        })

        expect(res.status).toBe(401);
    })

    it("return empty array for no org", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "authorization": `Bearer ${token}` },
        })

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            success: true,
            data: []
        });
    })

    it("returns the org, after creating one", async () =>
    {
        const { name, id } = await create_org(token, `ORG_name+${crypto.randomUUID()}`, true);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "authorization": `Bearer ${token}` },
        })

        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: true,
            data: {
                id: string;
                role: string;
                accepted: boolean;
                userId: string;
                orgId: string;
            }[];
        };

        expect(body.data.length).toBe(1);
        const firstItem = body.data[0]!;

        expect(firstItem.role).toBe("admin");
        expect(firstItem.accepted).toBe(true);
        expect(firstItem.userId).toBe(userid);
        expect(firstItem.orgId).toBe(id);
    })

    it("does not return hidden orgs to non-member user", async () =>
    {
        const { name, id } = await create_org(token, `ORG_name+${crypto.randomUUID()}`, false);

        const user = await create_user();
        const new_token = await login_user(user.email, user.password);
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${id}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "authorization": `Bearer ${new_token}` },
        })

        expect(res.status).toBe(404);
    })

    it("returns hidden orgs to admin/member user", async () =>
    {
        const { name, id } = await create_org(token, `ORG_name+${crypto.randomUUID()}`, false);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${id}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "authorization": `Bearer ${token}` },
        })

        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: true,
            data: {
                name: string;
                id: string;
                description: string;
                visible: boolean;
            }
        };
        expect(body.data.id).toBe(id);
        expect(body.data.visible).toBe(false);
    })

    it("List all users and their roles in the organization.", async () =>
    {
        const org = await create_org(token, `Org_name+${Math.random() * 21}`);

        const user1 = create_user();
        const user2 = create_user();

        let tkn1 = login_user((await user1).email, (await user1).password);
        let tkn2 = login_user((await user2).email, (await user2).password);

        let p1 = invite_user(org.id, (await user1).email, token);
        let p2 = invite_user(org.id, (await user2).email, token);

        await Promise.all([p1, p2]);

        let p3 = accept_invite(await tkn1, org.id);
        let p4 = accept_invite(await tkn2, org.id);

        await Promise.all([p3, p4]);

        await update_user_role(org.id, (await user1).email, token, "employee");

        const data = await (await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org.id}/members`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        })).json() as {
            success: true,
            data: ({
                user: {
                    email: string;
                    username: string;
                };
            } & {
                orgId: string;
                role: string;
                accepted: boolean;
            })[]
        } | {
            success: false,
            error: string
        };

        expect(data.success).toBe(true);
        if (data.success)
        {
            expect(data.data.length).toBe(3);
            expect(data.data.filter(x => x.role === "admin").length).toBe(1);
            expect(data.data.filter(x => x.role === "contributor").length).toBe(1);
            expect(data.data.filter(x => x.role === "employee").length).toBe(1);
        }
    })
}
