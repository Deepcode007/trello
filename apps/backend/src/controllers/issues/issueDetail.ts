import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function issueDetail(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
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
            gh_url: true,
            board: {
                select: {
                    title: true,
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
            },
            section: {
                select: {
                    title: true,
                    id: true
                }
            },
            issueMappings: {
                select: {
                    user: {
                        select: {
                            email: true,
                            username: true
                        }
                    }
                }
            }
        }
    })

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Members only");

    const { org, ...boardWithoutOrg } = issue.board;

    const updatedIssue = {
        ...issue,
        board: boardWithoutOrg
    };

    return res.status(200).json({
        success: true,
        data: updatedIssue
    })
}
