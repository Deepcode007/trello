import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function renameBoard(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim().min(1).optional(),
        description: zod.string().optional(),
        color: zod.string().optional(),
        isArchived: zod.boolean().optional()
    }).refine(data => data.title !== undefined || data.description !== undefined || data.color !== undefined || data.isArchived !== undefined, {
        message: "At least one field must be provided"
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
            org: {
                select: {
                    members: {
                        where: {
                            accepted: true,
                            userId: req.id,
                            role: {
                                in: ["admin", "employee"]
                            }
                        }
                    }
                }
            }
        }
    })

    if (!user) throw new Not_Found("Board not found/invalid Board Id");
    if (user.org.members.length == 0) throw new Forbidden("Admin/Employee access only");

    const board = await prisma.boards.update({
        where: {
            id: result.data.boardId
        },
        data: result2.data
    })

    wsBroadcaster.broadcast(board.id, {
        type: "board:updated",
        payload: { boardId: board.id, title: board.title, description: board.description, color: board.color, isArchived: board.isArchived }
    });

    return res.status(200).json({
        success: true,
        data: board
    })
}
