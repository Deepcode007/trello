import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function removeAssignment(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid(),
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.email()
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
            board: {
                select: {
                    org: {
                        select: {
                            id: true,
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
            },
            issueMappings: {
                where: {
                    issueId: result.data.issueId,
                    user: {
                        email: result2.data.email,
                    }
                },
                select: {
                    userId: true
                }
            }
        }
    })

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee only");
    if (issue.issueMappings.length === 0) throw new Not_Found("User/email not found");

    await prisma.issue_mapping.delete({
        where: {
            userId_issueId: {
                userId: issue.issueMappings[0]!.userId,
                issueId: result.data.issueId
            }
        }
    })

    return res.status(200).json({
        success: true,
        data: `unassigned ${result2.data.email}`
    })
}
