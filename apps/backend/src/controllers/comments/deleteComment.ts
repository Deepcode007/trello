import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
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
            deletedAt: true,
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
    });

    if (!comment || comment.deletedAt) throw new Not_Found("Comment not found");
    if (comment.issue.board.org.members.length === 0) throw new Forbidden("Members Only");

    const isAdmin = comment.issue.board.org.members[0]?.role === "admin";
    if (comment.userId !== req.id && !isAdmin) throw new Forbidden("Author/Admin Only");

    const oneDayInMs = 24 * 60 * 60 * 1000; // 86,400,000 ms
    const timeDiff = Date.now() - comment.createdAt.getTime();

    if (!isAdmin && timeDiff >= oneDayInMs) throw new Forbidden("Comment created more than 1 day ago");

    const { result: deleted } = await wsBroadcaster.executeWithOutbox(comment.issue.board.id, deletedComment => ({
        type: "comment:deleted",
        payload: { commentId: deletedComment.id, issueId: comment.issue.id, boardId: comment.issue.board.id }
    }), async tx =>
    {
        const deletedAt = new Date();
        const update = await tx.comments.updateMany({
            where: { id: comment.id, deletedAt: null },
            data: { deletedAt }
        });
        if (update.count === 0) throw new Not_Found("Comment not found");

        // Reparent children to the deleted comment's parent
        await tx.comments.updateMany({
            where: {
                parentId: comment.id
            },
            data: {
                parentId: comment.parentId
            }
        });

        // Invalidate/prune active unread mention notifications pointing to this deleted comment
        if (tx.notifications && typeof tx.notifications.findMany === "function" && typeof tx.notifications.deleteMany === "function")
        {
            try
            {
                const unreadNotifs = await tx.notifications.findMany({
                    where: {
                        type: "mention:comment",
                        read: false
                    }
                });

                const matchingIds = unreadNotifs
                    .filter((n: any) => n.data && (n.data as any).commentId === comment.id)
                    .map((n: any) => n.id);

                if (matchingIds.length > 0)
                {
                    await tx.notifications.deleteMany({
                        where: { id: { in: matchingIds } }
                    });
                }
            }
            catch (err)
            {
                console.warn("[deleteComment] Failed to prune unread mention notifications:", err);
            }
        }

        const updated = await tx.comments.findUnique({ where: { id: comment.id } });
        if (!updated) throw new Not_Found("Comment not found");
        return updated;
    });

    return res.status(200).json({
        success: true,
        data: deleted.id
    });
}
