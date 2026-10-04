import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";
import { create_boards } from "../helpers/create_board";

export function rename_board_test()
{
    let adminToken: string, employeeToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string;

    beforeAll(async () =>
    {
        const adminUser = await create_user();
        adminToken = await login_user(adminUser.email, adminUser.password);

        const org = await create_org(adminToken, `Org-${crypto.randomUUID()}`);
        orgId = org.id;

        const employeeUser = await create_user();
        employeeToken = await login_user(employeeUser.email, employeeUser.password);
        await invite_user(orgId, employeeUser.email, adminToken);
        await accept_invite(employeeToken, orgId);
        await update_user_role(orgId, employeeUser.email, adminToken, "employee");

        const contributorUser = await create_user();
        contributorToken = await login_user(contributorUser.email, contributorUser.password);
        await invite_user(orgId, contributorUser.email, adminToken);
        await accept_invite(contributorToken, orgId);

        const nonMemberUser = await create_user();
        nonMemberToken = await login_user(nonMemberUser.email, nonMemberUser.password);

        const board = await create_boards(adminToken, orgId);
        boardId = board!.id;
    });

    it("Fails with 401 when no token is provided", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Title" })
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid boardId is provided", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/not-a-uuid`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "New Title" })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 400 when title is missing", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({})
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when board does not exist", async () =>
    {
        const fakeId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${fakeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "New Title" })
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when user is not a member of the org", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` },
            body: JSON.stringify({ title: "New Title" })
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 403 when user is only a contributor", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` },
            body: JSON.stringify({ title: "New Title" })
        });
        expect(res.status).toBe(403);
    });

    it("Renames board successfully by employee", async () =>
    {
        const newTitle = `Renamed-By-Employee-${crypto.randomUUID()}`;
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${employeeToken}` },
            body: JSON.stringify({ title: newTitle })
        });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.title).toBe(newTitle);
        expect(body.data.id).toBe(boardId);
    });

    it("Renames board successfully by admin", async () =>
    {
        const newTitle = `Renamed-By-Admin-${crypto.randomUUID()}`;
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: newTitle })
        });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.data.title).toBe(newTitle);
    });
}
