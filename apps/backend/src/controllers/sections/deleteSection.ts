import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function deleteSection(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            board: {
                select: {
                    org: {
                        select: {
                            members: {
                                where: {
                                    userId: req.id,
                                    role: "admin"
                                }
                            }
                        }
                    }
                }
            },
            _count: {
                select: {
                    issues: {
                        where: {
                            sectionId: result.data.sectionId
                        }
                    }
                }
            }
        }
    })

    if (!user) throw new Not_Found("Section not found");
    if (user.board.org.members.length === 0) throw new Forbidden("Admin access required");

    const deleted = await prisma.sections.delete({
        where: {
            id: result.data.sectionId
        }
    })

    return res.status(200).json({
        success: true,
        data: `deleted board: ${deleted.title} and ${user._count} issues`
    })
}
