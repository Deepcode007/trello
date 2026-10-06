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

    const board = await prisma.boards.findUnique({
        where: {
            id: result.data.boardId
        },
        select: {
            section: {
                orderBy: {
                    position: "asc"
                },
                select: {
                    id: true,
                    title: true,
                    position: true
                }
            },
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
    })

    if (!board) throw new Not_Found("Board not found");
    if (board.org.members.length === 0) throw new Forbidden("Members only");

    return res.status(200).json({
        success: true,
        data: board.section.map(x => ({ id: x.id, title: x.title, position: x.position }))
    })
}
