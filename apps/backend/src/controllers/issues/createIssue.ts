import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function createIssue(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim().min(1),
        boardId: zod.uuid(),
        gh_url: zod.string().optional(),
        position: zod.number().optional(),
        description: zod.string().optional(),
        priority: zod.enum(["low", "medium", "high", "urgent"]).optional(),
        dueDate: zod.string().datetime().optional().transform(d => d ? new Date(d) : undefined),
        startDate: zod.string().datetime().optional().transform(d => d ? new Date(d) : undefined)
    }).safeParse(req.body);

    if (!result.success || !result2.success) throw new ValidationError();

    const user = await prisma.boards.findUnique({
        where: {
            id: result2.data.boardId
        },
        select: {
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

    if (!user) throw new Not_Found("Board not found");
    if (user.org.members.length === 0) throw new Forbidden("Members only");

    const section = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            boardId: true
        }
    });

    if (!section) throw new Not_Found("Section not found");
    if (section.boardId !== result2.data.boardId) {
        throw new ValidationError("Section belongs to a different board");
    }

    let position = result2.data.position;
    if (position === undefined) {
        const count = await prisma.issues.count({
            where: { sectionId: result.data.sectionId }
        });
        position = (count + 1) * 1000;
    }

    const issue = await prisma.issues.create({
        data: {
            ...result2.data,
            ...result.data,
            position
        }
    })

    wsBroadcaster.broadcastCardCreated(result2.data.boardId, issue);

    return res.status(201).json({
        success: true,
        data: issue
    })
}
