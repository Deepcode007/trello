import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function editComment(req: Request, res: Response)
{
    const result = zod.object({
        commentId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        description: zod.string().trim().min(1)
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
            deletedAt: true,
            userId: true,
            issue: {
                select: {
                    board: {
                        select: {
                            id: true,
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

    if (!comment || comment.deletedAt) throw new Not_Found("Comment not found");
    if (comment.issue.board.org.members.length === 0) throw new Forbidden("Members Only");
    if (comment.userId !== req.id) throw new Forbidden("Author Only");

    const oneDayInMs = 24 * 60 * 60 * 1000; // 86,400,000 ms
    const timeDiff = Date.now() - comment.createdAt.getTime();

    if (timeDiff >= oneDayInMs) throw new Forbidden("Comment created more than 1 day ago");

    const { result: updated } = await wsBroadcaster.executeWithOutbox(comment.issue.board.id, updatedComment => ({
        type: "comment:updated",
        payload: { comment: updatedComment, commentId: updatedComment.id, boardId: comment.issue.board.id }
    }), async tx =>
    {
        const update = await tx.comments.updateMany({
            where: { id: result.data.commentId, deletedAt: null },
            data: result2.data
        });
        if (update.count === 0) throw new Not_Found("Comment not found");

        const updatedComment = await tx.comments.findUnique({ where: { id: result.data.commentId } });
        if (!updatedComment) throw new Not_Found("Comment not found");
        return updatedComment;
    });

    return res.status(200).json({
        success: true,
        data: updated
    })
}
