import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function inviteUserHandler(req: Request, res: Response)
{
    const result1 = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.email()
    }).safeParse(req.body);

    if (!result1.success || !result2.success)
    {
        throw new ValidationError();
    }

    const user2 = await prisma.user.findUnique({
        where: {
            email: result2.data.email
        }
    })

    if (!user2)
    {
        throw new Not_Found("User not signed up");
    }

    const org = await prisma.orgs.findUnique({
        where: {
            id: result1.data.orgId,
        },
        select: {
            members: {
                select: {
                    role: true,
                    accepted: true,
                    userId: true
                }
            }
        }
    });

    if (!org)
    {
        throw new Not_Found("Org not found");
    }

    let admin = false, member = false, invited = false;

    org.members.forEach((x) =>
    {
        if (x.userId == req.id)
        {
            if (x.role === "admin") admin = true;
        }
        else if (x.userId == user2.id)
        {
            if (x.accepted == true) member = true;
            else invited = true;
        }
    })

    if (!admin) throw new Forbidden("Admin access required");
    if (member) throw new Duplicate("User already member");
    if (invited) throw new Duplicate("User already invited");

    await prisma.membership.create({
        data: {
            userId: user2.id,
            orgId: result1.data.orgId,
            role: "contributor"
        }
    })

    return res.status(201).json({
        success: true,
        data: "invited"
    })
}
