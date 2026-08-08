import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function assignIssue(req: Request, res: Response)
{
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.array(zod.email()).min(1)
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
            }
        }
    })

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee only");

    const validUsers = await prisma.membership.findMany({
        where: {
            orgId: issue.board.org.id,
            accepted: true,
            user: {
                email: { in: result2.data.email }
            }
        },
        select: {
            userId: true,
            user: {
                select: {
                    issueMappings: {
                        where: { issueId: result.data.issueId },
                        select: { userId: true }
                    }
                }
            }
        }
    })

    if (validUsers.length !== result2.data.email.length)
    {
        throw new ValidationError("One or more emails invalid or already assigned");
    }

    const entriesToCreate = validUsers.filter(x => x.user.issueMappings.length === 0);

    if (entriesToCreate.length === 0)
    {
        return res.status(200).json({
            success: true,
            data: "Already assigned"
        })
    }

    const mapping = entriesToCreate.map(x => ({
        userId: x.userId,
        issueId: result.data.issueId
    }))

    await prisma.issue_mapping.createMany({
        data: mapping
    })

    return res.status(200).json({
        success: true,
        data: `assigned ${mapping.length}`
    })
}
