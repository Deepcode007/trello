import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function getAllSections(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const section = await prisma.sections.findMany({
        where: {
            boardId: result.data.boardId
        },
        include: {
            board: {
                include: {
                    org: {
                        select: {
                            id: true
                        }
                    }
                }
            }
        }
    })

    if (!section) throw new Not_Found("Board not found");
    if (section.length===0) throw new Not_Found("No secitons available");

    const user = await prisma.membership.findUnique({
        where: {
            userId_orgId: {
                orgId: section[0]!.board.org.id,
                userId: req.id
            },
            accepted: true
        }
    })

    if (!user) throw new Forbidden("Members only");


    return res.status(200).json({
        success: true,
        data: section.filter(x=> {x.id, x.title})
    })
}
