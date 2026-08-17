export async function invite_user(org_id: string, user_email: string, token: string)
{
    // invite as contributor
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: user_email })
    })

    if (res.status != 201)
    {
        throw new Error("Unable to invite user");
    }
}
