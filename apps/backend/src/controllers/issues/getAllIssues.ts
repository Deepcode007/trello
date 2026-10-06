import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function getAllIssues(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const section = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            title: true,
            issues: {
                orderBy: {
                    position: "asc"
                },
                select: {
                    id: true,
                    title: true,
                    gh_url: true,
                    position: true
                }
            },
            board: {
                select: {
                    title: true,
                    org: {
                        select: {
                            members: {
                                where: {
                                    userId: req.id,
                                    accepted: true
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    if (!section) throw new Not_Found("Section not found");
    if (section.board.org.members.length === 0) throw new Forbidden("Members only");

    return res.status(200).json({
        success: true,
        data: section.issues.map(x => ({
            id: x.id,
            title: x.title,
            gh_url: x.gh_url,
            position: x.position,
            section: { title: section.title },
            board: section.board.title
        }))
    })
}
