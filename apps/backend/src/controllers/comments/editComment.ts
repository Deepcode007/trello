import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function editComment(req: Request, res: Response)
{
    const result = zod.object({
        commentId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        description: zod.string().trim()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const comment = await prisma.comments.findUnique({
        where: {
            id: result.data.commentId,
        },
        select: {
            id: true,
            createdAt: true,
            userId: true,
            issue: {
                select: {
                    board: {
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
                    }
                }
            }
        }
    })

    if (!comment) throw new Not_Found("Comment not found");
    if (comment.issue.board.org.members.length === 0) throw new Forbidden("Members Only");
    if (comment.userId !== req.id) throw new Forbidden("Author Only");

    const oneDayInMs = 24 * 60 * 60 * 1000; // 86,400,000 ms
    const timeDiff = Date.now() - comment.createdAt.getTime();

    if (timeDiff >= oneDayInMs) throw new Forbidden("Comment created more than 1 day ago");

    const updated = await prisma.comments.update({
        where: {
            id: result.data.commentId
        },
        data: result2.data
    })

    return res.status(201).json({
        success: true,
        data: updated
    })
}
