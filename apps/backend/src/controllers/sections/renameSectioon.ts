import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function renameSection(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            title: true,
            board: {
                select: {
                    org: {
                        select: {
                            members: {
                                where: {
                                    role: {
                                        in: ["admin", "employee"]
                                    },
                                    userId: req.id
                                }
                            }
                        }
                    }
                }
            }
        }
    })
    
    if (!user) throw new Not_Found("Invalid sectionId/Section Not found");
    if (user.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");
    
    const section = await prisma.sections.update({
        where: {
            id: result.data.sectionId
        },
        data: {
            title: result2.data.title,
        }
    })

    return res.status(200).json({
        success: true,
        data: section
    })
}
