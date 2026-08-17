export async function accept_invite(user_token: string, org_id: string)
{
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${org_id}/accept`, {
        headers: { "Content-Type": "application/json", authorization: `Bearer ${user_token}` }
    });

    if (res.status != 200)
    {
        throw new Error(`Error accepting invite, code: ${res.status}, ${res.statusText}`);
    }
}
