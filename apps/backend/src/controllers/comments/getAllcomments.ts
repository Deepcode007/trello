import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { buildCommentTree } from "../../helpers/commentTree";


export async function getAllComments(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const comments = await prisma.comments.findMany({
        where: {
            issueId: result.data.issueId
        },
        select: {
            id: true,
            description: true,
            createdAt: true,
            deletedAt: true,
            parentId: true,
            user: {
                select: {
                    username: true
                }
            },
            issue: {
                select: {
                    id: true,
                    title: true,
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
        },
        orderBy: {
            createdAt: "desc"
        },
    })

    if (comments.length===0) throw new Not_Found("Comments not found");
    if (comments[0]!.issue.board.org.members.length === 0) throw new Forbidden("Members only");

    
    const nestedComments = buildCommentTree(comments);

    return res.status(200).json({
        success: true,
        data: nestedComments
    })
}
