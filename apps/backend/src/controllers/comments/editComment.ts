import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";
import { parseMentions, validateMentions } from "../../helpers/mentions";
import { createNotification } from "../../services/notificationService";

export async function editComment(req: Request, res: Response)
{
    const result = zod.object({
        commentId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        description: zod.string().trim().min(1).max(10000)
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
            description: true,
            createdAt: true,
            deletedAt: true,
            userId: true,
            mentions: {
                select: {
                    userId: true
                }
            },
            issue: {
                select: {
                    id: true,
                    title: true,
                    board: {
                        select: {
                            id: true,
                            title: true,
                            orgId: true,
                            org: {
                                select: {
                                    id: true,
                                    name: true,
                                    members: {
                                        where: {
                                            userId: req.id,
                                            accepted: true
                                        },
                                        select: {
                                            role: true,
                                            user: {
                                                select: {
                                                    id: true,
                                                    name: true,
                                                    username: true
                                                }
                                            }
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
    if (comment.userId !== req.id) throw new Forbidden("Author Only");

    const oneDayInMs = 24 * 60 * 60 * 1000; // 86,400,000 ms
    const timeDiff = Date.now() - comment.createdAt.getTime();

    if (timeDiff >= oneDayInMs) throw new Forbidden("Comment created more than 1 day ago");

    const authorMember = comment.issue.board.org.members[0];
    const authorName = authorMember?.user?.name || authorMember?.user?.username || "Someone";
    const orgId = comment.issue.board.orgId || comment.issue.board.org.id;

    // Determine old mentions from DB records and previous description
    const oldMentionUserIds = new Set<string>([
        ...(comment.mentions?.map((m: any) => m.userId) || []),
        ...parseMentions(comment.description).map(m => m.userId)
    ]);

    const createdNotifications: Array<{
        recipientId: string;
        id: string;
        type: string;
        data: any;
        createdAt: Date;
    }> = [];

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

        // Parse and validate new mentions
        const newParsedMentions = parseMentions(result2.data.description);
        const validatedNewMentions = await validateMentions(
            newParsedMentions.slice(0, 20),
            orgId,
            req.id,
            tx
        );

        const newMentionUserIds = new Set<string>(validatedNewMentions.map(m => m.userId));

        // Added mentions = in new but not in old
        const addedMentions = validatedNewMentions.filter(m => !oldMentionUserIds.has(m.userId));

        // Removed mentions = in old but not in new
        const removedUserIds = Array.from(oldMentionUserIds).filter(userId => !newMentionUserIds.has(userId));

        // 1. Invalidate/delete removed mentions and their unread notifications
        if (removedUserIds.length > 0)
        {
            if (tx.mentions && typeof tx.mentions.deleteMany === "function")
            {
                await tx.mentions.deleteMany({
                    where: {
                        commentId: comment.id,
                        userId: { in: removedUserIds }
                    }
                });
            }

            if (tx.notifications && typeof tx.notifications.findMany === "function" && typeof tx.notifications.deleteMany === "function")
            {
                try
                {
                    const unreadNotifs = await tx.notifications.findMany({
                        where: {
                            recipientId: { in: removedUserIds },
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
                    console.warn("[editComment] Failed to prune removed mention notifications:", err);
                }
            }
        }

        // 2. Persist newly added mentions and create notifications (unchanged mentions are not re-notified)
        if (addedMentions.length > 0)
        {
            if (tx.mentions && typeof tx.mentions.createMany === "function")
            {
                await tx.mentions.createMany({
                    data: addedMentions.map(m => ({
                        commentId: comment.id,
                        userId: m.userId
                    })),
                    skipDuplicates: true
                });
            }
            else if (tx.mentions && typeof tx.mentions.create === "function")
            {
                for (const m of addedMentions)
                {
                    await tx.mentions.create({
                        data: {
                            commentId: comment.id,
                            userId: m.userId
                        }
                    });
                }
            }

            for (const m of addedMentions)
            {
                const notificationData = {
                    commentId: comment.id,
                    issueId: comment.issue.id,
                    issueTitle: comment.issue.title,
                    cardTitle: comment.issue.title,
                    boardId: comment.issue.board.id,
                    boardTitle: comment.issue.board.title,
                    orgId,
                    mentionedBy: req.id,
                    authorName,
                    mentionedByName: authorName,
                    commentPreview: result2.data.description.slice(0, 100)
                };

                const notif = await createNotification({
                    recipientId: m.userId,
                    type: "mention:comment",
                    data: notificationData
                }, tx);

                if (notif)
                {
                    createdNotifications.push({
                        id: notif.id,
                        recipientId: m.userId,
                        type: "mention:comment",
                        data: notificationData,
                        createdAt: notif.createdAt instanceof Date ? notif.createdAt : new Date()
                    });
                }
            }
        }

        const updatedComment = await tx.comments.findUnique({ where: { id: result.data.commentId } });
        if (!updatedComment) throw new Not_Found("Comment not found");
        return updatedComment;
    });

    // Realtime notification dispatch only for newly added mentions after successful commit
    for (const notif of createdNotifications)
    {
        try
        {
            if (typeof wsBroadcaster.notifyUser === "function")
            {
                await wsBroadcaster.notifyUser(notif.recipientId, {
                    type: "user:notification",
                    payload: {
                        notification: {
                            id: notif.id,
                            type: notif.type,
                            data: notif.data,
                            createdAt: notif.createdAt instanceof Date ? notif.createdAt.toISOString() : new Date().toISOString()
                        }
                    }
                });
            }
        }
        catch (err)
        {
            console.warn(`[editComment] Failed to dispatch realtime mention notification to ${notif.recipientId}:`, err);
        }
    }

    return res.status(200).json({
        success: true,
        data: updated
    });
}
