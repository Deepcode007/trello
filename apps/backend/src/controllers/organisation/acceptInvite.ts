import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function acceptInviteHandler(req: Request, res: Response)
{
    const result1 = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!result1.success)
    {
        throw new ValidationError();
    }

    const org = await prisma.orgs.findUnique({
        where: {
            id: result1.data.orgId,
            members: {
                some: {
                    userId: req.id
                }
            }
        },
        select: {
            members: true
        }
    });

    if (!org)
    {
        throw new Not_Found("Org not found");
    }

    if (org.members.length === 0) throw new Forbidden("User not invited");

    const member = org.members[0]!.accepted === true;
    if (member) throw new Duplicate("User already member");

    await prisma.membership.update({
        where: {
            userId_orgId: {
                userId: req.id,
                orgId: result1.data.orgId
            }
        },
        data: {
            accepted: true
        }
    })

    return res.status(200).json({
        success: true,
        data: "accepted"
    })
}
