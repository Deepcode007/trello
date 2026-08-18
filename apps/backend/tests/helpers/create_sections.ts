export async function create_sections(token: string, boardId: string, title?: string)
{
    if (!title) title = `Section_name:${crypto.randomUUID()}`;
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ title })
    });

    const body = await res.json() as {
        success: true,
        data: {
            title: string;
            id: string;
            boardId: string;
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
