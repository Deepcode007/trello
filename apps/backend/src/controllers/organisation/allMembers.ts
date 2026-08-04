import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod"
import { Not_Found, ValidationError } from "../../helpers/errorClass";


export async function OrgMembersHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const members = await prisma.membership.findMany({
        where: {
            org: {
                id: result.data.orgId
            }
        },
        omit: {
            id: true,
            userId: true
        },
        include: {
            user: {
                select: {
                    username: true,
                    email: true
                }
            }
        }
    })

    if (members.length===0)
    {
        throw new Not_Found();
    }

    return res.status(201).json({
        success: true,
        data: members
    })
}
