import { describe, expect, it } from "bun:test";
import { generateTestPassword } from "../helpers/passwordGenerator";

describe("User registration flow", () =>
{
    it("does not signup when passed invalid email", async () =>
    {
        const email = `test-${crypto.randomUUID()}@example`;
        const registerRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: generateTestPassword(), username: `${email}+username` }),
        });
        expect(registerRes.status).toBe(400);
    })

    it("does not signup when passed email and no password", async () =>
    {
        const email = `test-${crypto.randomUUID()}@example.com`;
        const registerRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, username: `${email}+username` }),
        });
        expect(registerRes.status).toBe(400);
    })

    it("does not signup when passed weak password", async () =>
    {
        const email = `test-${crypto.randomUUID()}@example.com`;
        const registerRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "onlylowerletters", username: `${email}+username` }),
        });
        expect(registerRes.status).toBe(400);
    })

    const final_email = `test-${crypto.randomUUID()}@example.com`;
    const password = generateTestPassword();

    it("does signup when passed correct credentials", async () =>
    {
        const registerRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: final_email, username: `${final_email}+username`, password }),
        });
        expect(registerRes.status).toBe(201);

        const body = (await registerRes.json()) as any;
        expect(body.success).toBe(true);
        expect(body.data.email).toBe(final_email);
    })

    it("does not signup when passed same email", async () =>
    {
        const registerRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: final_email, username: `${final_email}+username`, password }),
        });
        
        expect(registerRes.status).toBe(409);
    })

})
