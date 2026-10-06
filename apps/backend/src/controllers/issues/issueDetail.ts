import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function issueDetail(req: Request, res: Response)
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
            id: true,
            title: true,
            description: true,
            position: true,
            priority: true,
            dueDate: true,
            startDate: true,
            isArchived: true,
            gh_url: true,
            createdAt: true,
            updatedAt: true,
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
                            id: true,
                            email: true,
                            username: true,
                            name: true,
                            avatarUrl: true
                        }
                    }
                }
            },
            checklists: {
                orderBy: { position: "asc" },
                select: {
                    id: true,
                    title: true,
                    position: true,
                    items: {
                        orderBy: { position: "asc" },
                        select: {
                            id: true,
                            content: true,
                            isCompleted: true,
                            position: true,
                            dueDate: true
                        }
                    }
                }
            },
            labels: {
                select: {
                    label: {
                        select: {
                            id: true,
                            name: true,
                            color: true
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
