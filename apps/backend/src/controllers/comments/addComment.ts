import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function addComment(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        parentId: zod.uuid().optional(),
        description: zod.string().trim().min(1)
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
            comments: {
                where: {
                    id: result2.data.parentId,
                    deletedAt: null
                }
            },
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
    })

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Members Only");
    if (result2.data.parentId && issue.comments.length === 0) throw new Not_Found("Parent comment not found");

    const { result: created } = await wsBroadcaster.executeWithOutbox(issue.board.id, comment => ({
        type: "comment:created",
        payload: { comment, issueId: result.data.issueId, boardId: issue.board.id }
    }), tx => tx.comments.create({
        data: { ...result.data, ...result2.data, userId: req.id }
    }));

    return res.status(201).json({
        success: true,
        data: created
    })
}
