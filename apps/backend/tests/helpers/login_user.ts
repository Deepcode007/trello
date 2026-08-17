import jwt from "jsonwebtoken";

export async function login_user(email: string, password: string)
{
    const loginRes = await fetch(`${globalThis.TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });

    const body = await loginRes.json() as {
        success: true,
        data: string
    };

    const isToken = () =>
    {
        const decoded = jwt.decode(body.data);
        if (decoded === null) return false;
        else return true;
    }

    if (loginRes.status != 200 || !isToken())
    {
        throw new Error("unable to login");
    }

    return body.data;
}
