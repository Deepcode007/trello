import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";

export function get_sections_test()
{
    let adminToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, emptyBoardId: string;
    let section1Title: string;

    beforeAll(async () =>
    {
        const adminUser = await create_user();
        adminToken = await login_user(adminUser.email, adminUser.password);

        const org = await create_org(adminToken, `Org-${crypto.randomUUID()}`);
        orgId = org.id;

        const contributorUser = await create_user();
        contributorToken = await login_user(contributorUser.email, contributorUser.password);
        await invite_user(orgId, contributorUser.email, adminToken);
        await accept_invite(contributorToken, orgId);

        const nonMemberUser = await create_user();
        nonMemberToken = await login_user(nonMemberUser.email, nonMemberUser.password);

        const board = await create_boards(adminToken, orgId);
        boardId = board!.id;

        const emptyBoard = await create_boards(adminToken, orgId);
        emptyBoardId = emptyBoard!.id;

        section1Title = `Section-1-${crypto.randomUUID()}`;
        await create_sections(adminToken, boardId, section1Title);
        await create_sections(adminToken, boardId, `Section-2-${crypto.randomUUID()}`);
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid boardId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/invalid-uuid/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when board does not exist", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${crypto.randomUUID()}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(404);
    });

    it("Returns an empty list when board has no sections", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${emptyBoardId}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { id: string; title: string }[] };
        expect(body.success).toBe(true);
        expect(body.data).toEqual([]);
    });

    it("Fails with 403 when user is non-member", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` }
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 403 for non-member even when board has no sections", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${emptyBoardId}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` }
        });
        expect(res.status).toBe(403);
    });

    it("Member (contributor) gets list of sections successfully", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { id: string; title: string }[] };
        expect(body.success).toBe(true);
        expect(body.data.length).toBe(2);
        expect(body.data.map(x => x.title)).toContain(section1Title);
        expect(body.data[0]!.id).toBeDefined();
    });

    it("Admin gets list of sections successfully", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/sections`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { id: string; title: string }[] };
        expect(body.success).toBe(true);
        expect(body.data.length).toBe(2);
    });
}
