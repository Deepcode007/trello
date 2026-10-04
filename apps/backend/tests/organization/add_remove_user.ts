import { beforeAll, describe, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";

export function add_remove_users_and_roles()
{
    describe("Add users", () =>
    {
        let token: string, orgId: string;
        beforeAll(async () =>
        {
            const user = await create_user();
            token = await login_user(user.email, user.password);

            const org = await create_org(token, `Org_name=${Math.random() * 102}`);
            orgId = org.id;
        })

        it("fails if user not exits", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: `${crypto.randomUUID()}@gmail123.com` })
            });

            expect(res.status).toBe(404);
            expect(((await res.json()) as any)!.error).toBe("User not signed up");
        })

        it("invites the user, fails if reinvited", async () =>
        {
            const user1 = await create_user();

            const res1 = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: user1.email })
            });

            expect(res1.status).toBe(201);

            const res2 = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: user1.email })
            });

            expect(res2.status).toBe(409);
            expect(((await res2.json()) as any)!.error).toBe("User already invited");
        })


        it("invites the user, accepts, fails if reinvited", async () =>
        {
            const user1 = await create_user();
            const tkn = await login_user(user1.email, user1.password);

            const res1 = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: user1.email })
            });

            expect(res1.status).toBe(201);

            const accepted = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/accept`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` }
            });

            expect(accepted.status).toBe(200);

            const res2 = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: user1.email })
            });

            expect(res2.status).toBe(409);
            expect(((await res2.json()) as any)!.error).toBe("User already member");
        })
    })

    describe("Update Role", () =>
    {
        let token: string, orgId: string;
        beforeAll(async () =>
        {
            const user = await create_user();
            token = await login_user(user.email, user.password);

            const org = await create_org(token, `Org_name=${Math.random() * 102}`);
            orgId = org.id;
        })

        it("fails if not admin", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn, orgId);

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
                body: JSON.stringify({ email, role: "employee" })
            });

            expect(res.status).toBe(403);
        })

        it("fails if already same role", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn, orgId);
            await update_user_role(orgId, email, token, "employee");

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email, role: "employee" })
            });

            expect(res.status).toBe(409);
        })

        it("fails if user not member", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email, role: "employee" })
            });

            expect(res.status).toBe(404);
        })

        it("updates role", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn, orgId);

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email, role: "employee" })
            });

            expect(res.status).toBe(201);
        })
    })

    describe("Remove user", () =>
    {
        let token: string, orgId: string, admin: { email: string; password: string; username: string; id: string; };
        beforeAll(async () =>
        {
            const user = await create_user();
            admin = user;
            token = await login_user(user.email, user.password);

            const org = await create_org(token, `Org_name=${Math.random() * 102}`);
            orgId = org.id;
        })

        it("fails if not admin but not self", async () =>
        {
            const { email, password } = await create_user();
            const tkn2 = await login_user(email, password);
            const user3 = await create_user();
            const tkn3 = await login_user(user3.email, user3.password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn2, orgId);

            await invite_user(orgId, user3.email, token);
            await accept_invite(tkn3, orgId)

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn2}` },
                body: JSON.stringify({ email: user3.email })
            });

            expect(res.status).toBe(403);
        })

        it("deletes if not admin but self", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn, orgId);

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` },
                body: JSON.stringify({ email })
            });

            expect(res.status).toBe(200);
        })

        it("fails if user not member", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email })
            });

            expect(res.status).toBe(404);
        })

        it("deletes user", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn, orgId);

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email })
            });

            expect(res.status).toBe(200);
        })

        it("fails if last admin and self remove", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: admin.email })
            });

            expect(res.status).toBe(403);
            expect(((await res.json()) as any)!.error).toBe("No more admins left");
        })


        it("deletes self admin if another admin left", async () =>
        {
            const { email, password } = await create_user();
            const tkn = await login_user(email, password);
            // contributor
            await invite_user(orgId, email, token);
            await accept_invite(tkn, orgId);
            await update_user_role(orgId, email, token, "admin");
            
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/members`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: admin.email })
            });

            expect(res.status).toBe(200);
        })


    })
}
