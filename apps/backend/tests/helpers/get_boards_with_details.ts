export async function get_boards_details(token: string, boardId: string)
{
    const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` }
    });

    const body = await res.json() as {
        success: true,
        data: {
            orgId: string;
            title: string;
            section: {
                title: string;
                id: string;
                issues: {
                    title: string;
                    id: string;
                    boardId: string;
                    gh_url: string | null;
                    sectionId: string | null;
                }[];
            }[];
        }
    } | {
        success: false,
        error: string
    };

    if (res.status != 200 && body.success == false)
    {
        throw new Error(`Unable to get board details, code: ${res.status}, error: ${body.error}`)
    }

    if (body.success) return body.data;
}
