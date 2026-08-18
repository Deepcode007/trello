export async function create_boards(token: string, orgId: string)
{
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs/${orgId}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
            title: `Board_name:${crypto.randomUUID()}`
        })
    });

    const body = await res.json() as {
        success: true,
        data: {
            orgId: string;
            id: string;
            title: string;
        }
    } | {
        success: false,
        error: string
    };

    if (res.status != 201 && body.success == false)
    {
        throw new Error(`Unable to create a board, code: ${res.status}, error: ${body.error}`)
    }

    if (body.success) return body.data;
}
