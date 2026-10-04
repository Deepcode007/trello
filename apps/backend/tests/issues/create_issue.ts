import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";

export function create_issue_test()
{
    let adminToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string;

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

        const section = await create_sections(adminToken, boardId);
        sectionId = section!.id;
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Issue 1", boardId })
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid sectionId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/not-a-uuid/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "Issue 1", boardId })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 400 when missing boardId", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "Only Title" })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when board does not exist", async () =>
    {
        const fakeBoardId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "Issue 1", boardId: fakeBoardId })
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when user is not a member of the org", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` },
            body: JSON.stringify({ title: "Issue 1", boardId })
        });
        expect(res.status).toBe(403);
    });

    it("Contributor creates issue successfully", async () =>
    {
        const title = `Issue-Contributor-${crypto.randomUUID()}`;
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` },
            body: JSON.stringify({ title, boardId })
        });
        expect(res.status).toBe(201);
        const body = await res.json() as { success: boolean; data: { title: string; boardId: string; sectionId?: string } };
        expect(body.success).toBe(true);
        expect(body.data.title).toBe(title);
        expect(body.data.boardId).toBe(boardId);
        expect(body.data.sectionId).toBe(sectionId);
    });

    it("Admin creates issue with gh_url successfully", async () =>
    {
        const title = `Issue-Admin-${crypto.randomUUID()}`;
        const gh_url = "https://github.com/org/repo/issues/1";
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title, boardId, gh_url })
        });
        expect(res.status).toBe(201);
        const body = await res.json() as { success: boolean; data: { title: string; gh_url: string } };
        expect(body.success).toBe(true);
        expect(body.data.title).toBe(title);
        expect(body.data.gh_url).toBe(gh_url);
    });

    it("Fails with 400 when title is missing", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ boardId })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 400 when boardId is not a UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "Issue", boardId: "not-a-uuid" })
        });
        expect(res.status).toBe(400);
    });
}
