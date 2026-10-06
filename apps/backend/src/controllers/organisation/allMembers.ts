import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function OrgMembersHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const requesterMembership = await prisma.membership.findUnique({
        where: {
            userId_orgId: {
                userId: req.id,
                orgId: result.data.orgId
            },
            accepted: true
        }
    });

    if (!requesterMembership)
    {
        throw new Forbidden("Member access only");
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
    });

    if (members.length === 0)
    {
        throw new Not_Found();
    }

    return res.status(200).json({
        success: true,
        data: members
    });
}
