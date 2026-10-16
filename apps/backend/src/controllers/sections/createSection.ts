import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function createSection(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim().min(1),
        position: zod.number().optional()
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
                            userId: req.id,
                            accepted: true
                        }
                    }
                }
            }
        }
    })

    if (!user) throw new Not_Found("Invalid Boardid/Board Not found");
    if (user.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    let position = result2.data.position;
    if (position === undefined)
    {
        const lastSection = await prisma.sections.findFirst({
            where: { boardId: result.data.boardId },
            orderBy: { position: "desc" },
            select: { position: true }
        });
        position = (lastSection?.position ?? 0) + 1000;
    }

    const { result: section } = await wsBroadcaster.executeWithOutbox(result.data.boardId, created => ({
        type: "list:created",
        payload: { listData: created }
    }), tx => tx.sections.create({
        data: { title: result2.data.title, boardId: result.data.boardId, position }
    }));

    return res.status(201).json({
        success: true,
        data: section
    })
}
