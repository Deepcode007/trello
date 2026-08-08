import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function deleteComment(req: Request, res: Response)
{
    const result = zod.object({
        commentId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
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
            parentId: true,
            issue: {
                select: {
                    board: {
                        select: {
                            org: {
                                select: {
                                    members: {
                                        select: {
                                            role: true,
                                            userId: true
                                        },
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
    if (comment.userId !== req.id && comment.issue.board.org.members[0]?.role !== "admin") throw new Forbidden("Author/Admin Only");

    const oneDayInMs = 24 * 60 * 60 * 1000; // 86,400,000 ms
    const timeDiff = Date.now() - comment.createdAt.getTime();

    if (timeDiff >= oneDayInMs) throw new Forbidden("Comment created more than 1 day ago");

    const deleted = await prisma.$transaction(async (tx) =>
    {
        await tx.comments.updateMany({
            where: {
                parentId: comment.id
            },
            data: {
                parentId: comment.parentId
            }
        });

        const updated = await tx.comments.update({
            where: { id: comment.id },
            data: {
                deletedAt: new Date()
            }
        });

        return updated;
    });

    return res.status(201).json({
        success: true,
        data: deleted.id
    })
}
