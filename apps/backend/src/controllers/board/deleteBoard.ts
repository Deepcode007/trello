import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function deleteBoard(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const board = await prisma.boards.findUnique({
        where: {
            id: result.data.boardId
        },
        include: {
            org: {
                select: {
                    id: true
                }
            }
        }
    })
    if (!board) throw new Not_Found("Board not found");
    

    const user = await prisma.membership.findUnique({
        where: {
            userId_orgId: {
                userId: req.id,
                orgId: board.org.id
            },
            role: {
                in: ["admin", "employee"]
            },
            accepted: true
        }
    })

    if (!user) throw new Forbidden("Employee/Admin access only");

    await prisma.boards.delete({
        where: {
            id: result.data.boardId
        }
    })


    return res.status(200).json({
        success: true,
        data: "board deleted"
    })
}
