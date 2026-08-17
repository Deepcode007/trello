import { generateTestPassword } from "./passwordGenerator";

export async function create_user()
{
    const email = `test-${crypto.randomUUID()}@example.com`;
    const password = generateTestPassword();
    const loginRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, username: `${email}+username`, password }),
    });

    const body = await loginRes.json() as {
        success: true, data: {
            email: string,
            id: string,
            username: string
        }
    } | {
        success: false,
        error: string
    };

    if (!body.success || loginRes.status != 201)
    {
        throw new Error("Unable to create a user");
    }
    return { email, password, username: body.data.username, id: body.data.id }

}
