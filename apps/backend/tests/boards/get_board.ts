import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { create_boards } from "../helpers/create_board";

export function get_boards()
{
    let orgId: string, token: string, boardTitle:string;
    beforeAll(async () =>
    {
        const user = await create_user();
        token = await login_user(user.email, user.password);

        const org = await create_org(token, `Org_name:${Math.random() * 12}`);
        orgId = org.id;

        const board = await create_boards(token, orgId);
        boardTitle = board?.title!;
    })


    it("Fails if user not member", async () =>
    {
        const user1 = await create_user();
        const tkn = await login_user(user1.email, user1.password);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/boards`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` }
        })

        expect(res.status).toBe(403);
    })

    it("Gives the list of Boards", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/boards`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` }
        })

        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: true,
            data: {
                _count: {
                    issues: number;
                };
                title: string;
            }[]
        };

        expect(body.data.length).toBe(1);
        expect(body.data[0]?.title).toBe(boardTitle);
    })
}
