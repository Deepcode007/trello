import { beforeAll, describe, expect, it } from "bun:test";
import { generateTestPassword } from "../helpers/passwordGenerator";
import jwt from "jsonwebtoken";

describe("User login flow", () =>
{
    const email = `test-${crypto.randomUUID()}@example.com`;
    const password = generateTestPassword();

    beforeAll(async () =>
    {
        const loginRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, username: `${email}+username`, password }),
        });
        expect(loginRes.status).toBe(201);

        const body = (await loginRes.json()) as any;
        expect(body.success).toBe(true);
        expect(body.data.email).toBe(email);
    })

    it("does not login when passed new email", async () =>
    {
        const loginRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: `${crypto.randomUUID()}@gmail.com`, password }),
        });

        expect(loginRes.status).toBe(404);
    })

    it("does not login when passed wrong password", async () =>
    {
        const loginRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, password: generateTestPassword() }),
        });

        expect(loginRes.status).toBe(401);
        const body = (await loginRes.json()) as any;
        expect(body.error).toBe("Invalid Password");
    })

    let token: string;
    it("does login when passed correct credentials", async () =>
    {
        const loginRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        expect(loginRes.status).toBe(200);
        const body = (await loginRes.json()) as any;
        expect(body.data).toSatisfy(x =>
        {
            const decoded = jwt.decode(x);
            if (decoded === null) return false;
            else return true;
        })

        token = body.data;
    })

    it("forbid user with no token or bad token", async () =>
    {
        const noToken = await fetch(`${globalThis.TEST_BASE_URL}/api/users/me`, {
            method: "GET",
            headers: { "Content-Type": "application/json"}
        });

        expect(noToken.status).toBe(401);
        const body = (await noToken.json()) as any;
        expect(body.error).toBe("User unauthorised");

        const Token = await fetch(`${globalThis.TEST_BASE_URL}/api/users/me`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}7ruft`}
        });

        expect(Token.status).toBe(401);
    })

    it("allow user with token", async () =>
    {
        const Token = await fetch(`${globalThis.TEST_BASE_URL}/api/users/me`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}`}
        });

        expect(Token.status).toBe(200);
        const body = (await Token.json()) as any;

        expect(body.data.email).toBe(email);
        expect(body.data.username).toBe(`${email}+username`);
    })

})
