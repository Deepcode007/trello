export async function create_issue(token: string, sectionId: string, boardId: string, gh_url?: string)
{
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
            title: `Issue_name:${crypto.randomUUID()}`,
            boardId: boardId,
            gh_url: gh_url
        })
    });

    const body = await res.json() as {
        success: true,
        data: {
            title: string;
            id: string;
            boardId: string;
            sectionId: string | null;
            gh_url: string | null;
        }
    } | {
        success: false,
        error: string
    };

    if (res.status != 201 && body.success == false)
    {
        throw new Error(`Unable to create an issue, code: ${res.status}, error: ${body.error}`)
    }

    if (body.success) return body.data;
}
