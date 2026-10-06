import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

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
                    id: true,
                    board: {
                        select: {
                            id: true,
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
    
    const isAdmin = comment.issue.board.org.members[0]?.role === "admin";
    if (comment.userId !== req.id && !isAdmin) throw new Forbidden("Author/Admin Only");

    const oneDayInMs = 24 * 60 * 60 * 1000; // 86,400,000 ms
    const timeDiff = Date.now() - comment.createdAt.getTime();

    if (!isAdmin && timeDiff >= oneDayInMs) throw new Forbidden("Comment created more than 1 day ago");

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

    wsBroadcaster.broadcast(comment.issue.board.id, {
        type: "comment:deleted",
        payload: { commentId: deleted.id, issueId: comment.issue.id, boardId: comment.issue.board.id }
    });

    return res.status(201).json({
        success: true,
        data: deleted.id
    })
}
