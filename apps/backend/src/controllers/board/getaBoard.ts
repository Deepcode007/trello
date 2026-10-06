import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function getBoardDetails(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success) throw new ValidationError();

    const board = await prisma.boards.findUnique({
        where: {
            id: result.data.boardId
        },
        select: {
            id: true,
            title: true,
            description: true,
            color: true,
            isArchived: true,
            section: {
                orderBy: {
                    position: "asc"
                },
                select: {
                    issues: {
                        orderBy: {
                            position: "asc"
                        }
                    },
                    title: true,
                    id: true,
                    position: true
                }
            },
            orgId: true
        }
    })
    
    if (!board) throw new Not_Found("Org not found/invalid Org Id");

    const user = await prisma.membership.findUnique({
        where: {
            userId_orgId: {
                userId: req.id,
                orgId: board?.orgId
            },
            accepted: true
        }
    })
    
    if (!user) throw new Forbidden("Member access only");


    return res.status(200).json({
        success: true,
        data: board
    })
}
