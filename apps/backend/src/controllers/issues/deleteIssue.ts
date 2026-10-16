import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function deleteIssue(req: Request, res: Response)
{
    const issueIdParam = req.params.issueId ?? req.params.cardId ?? req.params.id;
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse({ issueId: issueIdParam });

    if (!result.success)
    {
        throw new ValidationError();
    }

    const issue = await prisma.issues.findUnique({
        where: {
            id: result.data.issueId
        },
        select: {
            boardId: true,
            board: {
                select: {
                    org: {
                        select: {
                            members: {
                                where: {
                                    userId: req.id,
                                    role: {
                                        in: ["admin", "employee"]
                                    },
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
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee only");

    const { result: deleted } = await wsBroadcaster.executeWithOutbox(
        issue.boardId,
        deletedIssue => ({ type: "card:deleted", payload: { cardId: deletedIssue.id } }),
        tx => tx.issues.delete({ where: { id: result.data.issueId } })
    );

    return res.status(200).json({
        success: true,
        data: `issue: "${(deleted as any).title}" deleted`
    })
}
