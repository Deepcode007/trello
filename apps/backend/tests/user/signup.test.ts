import { describe, expect, it } from "bun:test";

describe("User registration flow", ()=> {
    it("does not signup when passed invalid email", async() =>
    {
        const email = `test-${crypto.randomUUID()}@example`;
            
            // Step 1: Register User
            const registerRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password: "password123" }),
            });
            expect(registerRes.status).toBe(400);
    })
    
})