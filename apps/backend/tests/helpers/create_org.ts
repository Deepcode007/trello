export async function create_org(token: string, name: string, visible: boolean | "true" | "false" = true, description?: string)
{
    if (!description) description = "description" + crypto.randomUUID().toString();

    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/orgs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, description, visible })
    })

    if (res.status != 201)
    {
        throw new Error("Unable to create new Org");
    }

    const body = await res.json() as {
        success: true,
        data: {
            description: string,
            name: string,
            visible: boolean,
            id: string,
        }
    }

    return body.data;
}
