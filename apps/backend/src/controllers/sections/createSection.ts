import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function createSection(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.boards.findUnique({
        where: {
            id: result.data.boardId
        },
        select: {
            title: true,
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
    })
    
    if (!user) throw new Not_Found("Invalid Boardid/Board Not found");
    if (user.org.members.length === 0) throw new Forbidden("Admin/Employee access required");
    
    const section = await prisma.sections.create({
        data: {
            title: result2.data.title,
            boardId: result.data.boardId
        }
    })

    return res.status(200).json({
        success: true,
        data: section
    })
}
