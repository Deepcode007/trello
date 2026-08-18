import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";

export function get_boards_issue_sections()
{
    let orgId: string, token: string,
        boards: {
            orgId: string;
            id: string;
            title: string;
        },
        issues: {
            title: string;
            id: string;
            boardId: string;
            sectionId: string | null;
            gh_url: string | null;
        }[] = [],
        sections: {
            title: string;
            id: string;
            boardId: string;
        }[] = [];

    beforeAll(async () =>
    {
        const user = await create_user();
        token = await login_user(user.email, user.password);

        const org = await create_org(token, `Org_name:${Math.random() * 12}`);
        orgId = org.id;

        const board = await create_boards(token, orgId);

        const section1 = await create_sections(token, board!.id);
        const section2 = await create_sections(token, board!.id);

        const issue1 = await create_issue(token, section1!.id, board!.id)
        const issue2 = await create_issue(token, section2!.id, board!.id)
        const issue3 = await create_issue(token, section2!.id, board!.id)

        issues.push(issue1!);
        issues.push(issue2!);
        issues.push(issue3!);

        sections.push(section1!);
        sections.push(section2!);
        
        boards = board!;
    })


    it("Fails if user not member", async () =>
    {
        const user1 = await create_user();
        const tkn = await login_user(user1.email, user1.password);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boards.id}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` }
        })

        expect(res.status).toBe(403);
    })

    it("passes when member", async () =>
    {
        const user1 = await create_user();
        const tkn = await login_user(user1.email, user1.password);

        // contributor
        await invite_user(orgId, user1.email, token);
        await accept_invite(tkn, orgId);

        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boards.id}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${tkn}` }
        })

        const body = await res.json() as {
            success: false,
            error: string
        } | {
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
        };

        expect(body.success).toBe(true);
        if (body.success)
        {
            expect(body.data.orgId).toBe(orgId);
            expect(body.data.title).toBe(boards.title);
            expect(body.data.section).toBeDefined();
            expect(body.data.section.length).toBe(sections.length);
            expect(body.data.section.find(x =>
            {
                return x.title == sections[0]?.title
            })).toBeDefined()

            expect(body.data.section.find(x =>
            {
                return x.title == sections[1]?.title
            })).toBeDefined()

            

        
            expect(body.data.section.find(x =>
            {
                return x.id == issues[0]?.sectionId
            })?.issues.find(x =>
            {
                return x.id == issues[0]?.id
            })).toBeDefined()

            expect(body.data.section.find(x =>
            {
                return x.id == issues[1]?.sectionId
            })?.issues.find(x =>
            {
                return x.id == issues[1]?.id
            })).toBeDefined()

            expect(body.data.section.find(x =>
            {
                return x.id == issues[2]?.sectionId
            })?.issues.find(x =>
            {
                return x.id == issues[2]?.id
            })).toBeDefined()
        }
    })

}
