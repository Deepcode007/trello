import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";
import { parseMentions, validateMentions } from "../../helpers/mentions";
import { createNotification } from "../../services/notificationService";

export async function addComment(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        parentId: zod.uuid().optional(),
        description: zod.string().trim().min(1).max(10000)
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const issue = await prisma.issues.findUnique({
        where: {
            id: result.data.issueId
        },
        select: {
            id: true,
            title: true,
            comments: {
                where: {
                    id: result2.data.parentId,
                    deletedAt: null
                }
            },
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
    });

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Members Only");
    if (result2.data.parentId && issue.comments.length === 0) throw new Not_Found("Parent comment not found");

    const authorMember = issue.board.org.members[0];
    const authorName = authorMember?.user?.name || authorMember?.user?.username || "Someone";
    const orgId = issue.board.orgId || issue.board.org.id;

    const createdNotifications: Array<{
        recipientId: string;
        id: string;
        type: string;
        data: any;
        createdAt: Date;
    }> = [];

    const { result: created } = await wsBroadcaster.executeWithOutbox(issue.board.id, comment => ({
        type: "comment:created",
        payload: { comment, issueId: result.data.issueId, boardId: issue.board.id }
    }), async tx =>
    {
        const comment = await tx.comments.create({
            data: { ...result.data, ...result2.data, userId: req.id }
        });

        // Parse and validate mentions
        const parsedMentions = parseMentions(result2.data.description);

        if (parsedMentions.length > 0)
        {
            const validatedMentions = await validateMentions(
                parsedMentions.slice(0, 20),
                orgId,
                req.id,
                tx
            );

            if (validatedMentions.length > 0)
            {
                // Persist mention records
                if (tx.mentions && typeof tx.mentions.createMany === "function")
                {
                    await tx.mentions.createMany({
                        data: validatedMentions.map(m => ({
                            commentId: comment.id,
                            userId: m.userId
                        })),
                        skipDuplicates: true
                    });
                }
                else if (tx.mentions && typeof tx.mentions.create === "function")
                {
                    for (const m of validatedMentions)
                    {
                        await tx.mentions.create({
                            data: {
                                commentId: comment.id,
                                userId: m.userId
                            }
                        });
                    }
                }

                // Create persistent notifications for each valid mentioned user
                for (const m of validatedMentions)
                {
                    const notificationData = {
                        commentId: comment.id,
                        issueId: issue.id,
                        issueTitle: issue.title,
                        cardTitle: issue.title,
                        boardId: issue.board.id,
                        boardTitle: issue.board.title,
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
        }

        return comment;
    });

    // Realtime notification dispatch after successful commit
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
            console.warn(`[addComment] Failed to dispatch realtime mention notification to ${notif.recipientId}:`, err);
        }
    }

    return res.status(201).json({
        success: true,
        data: created
    });
}
