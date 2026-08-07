import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function createIssue(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string(),
        description: zod.string(),
        boardId: zod.uuid(),
        gh_url: zod.string().optional()
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

    const issue = await prisma.issues.create({
        data: {
            ...result2.data,
            ...result.data
        }
    })

    return res.status(201).json({
        success: true,
        data: issue
    })
}
