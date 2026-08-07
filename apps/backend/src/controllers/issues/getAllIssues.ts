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

    const issues = await prisma.issues.findMany({
        where: {
            sectionId: result.data.sectionId,
            board: {
                org: {
                    members: {
                        some: {
                            userId: req.id,
                            accepted: true
                        }
                    }
                }
            }
        },
        select: {
            id: true,
            title: true,
            gh_url: true,
            section: {
                select: {
                    title: true
                }
            },
            board: {
                select: {
                    title: true,
                    org: {
                        select: {
                            members: {
                                select: {
                                    userId: true,
                                    role: true
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    if (!issues[0]?.section) throw new Not_Found("Section not found");
    if (issues[0] && issues[0].board.org.members.length === 0) throw new Forbidden("Members only");


    return res.status(200).json({
        success: true,
        data: issues.map(x=> {x.id, x.title, x.gh_url, x.section, x.board.title})
    })
}
