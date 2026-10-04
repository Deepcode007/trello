import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function updateIssue(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().optional(),
        sectionId: zod.uuid().optional(),
        gh_url: zod.string().optional()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const issue = await prisma.issues.findUnique({
        where: {
            id: result.data.issueId
        },
        select: {
            boardId: true,
            board: {
                select: {
                    org: {
                        select: {
                            members: {
                                where: {
                                    userId: req.id,
                                    accepted: true,
                                    role: {
                                        in: ["admin", "employee"]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access only");

    if (result2.data.sectionId)
    {
        const section = await prisma.sections.findUnique({
            where: { id: result2.data.sectionId },
            select: { boardId: true }
        });
        if (!section) throw new Not_Found("Section not found");
        if (section.boardId !== issue.boardId) throw new ValidationError("Section belongs to a different board");
    }

    const updated = await prisma.issues.update({
        where: {
            id: result.data.issueId
        },
        data: {
            ...result2.data
        }
    })


    return res.status(200).json({
        success: true,
        data: updated
    })
}
