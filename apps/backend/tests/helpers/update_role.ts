export async function update_user_role(org_id: string, email: string, token: string, role: "admin"|"employee")
{
    // invite as contributor
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, role })
    })

    if (res.status != 201)
    {
        const body = await res.json() as {
            success: false,
            error: string
        };
        throw new Error(`Unable to invite user. code: ${res.status}, error:${body.error}`);
    }
}
