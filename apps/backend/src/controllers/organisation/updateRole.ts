import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function updateRoleHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.email(),
        role: zod.enum(["admin", "employee"])
    }).safeParse(req.body);

    if (!result.success || !result2.success) throw new ValidationError();

    const org = await prisma.orgs.findUnique({
        where: {
            id: result.data.orgId
        },
        select: {
            members: {
                where: {
                    accepted: true
                },
                select: {
                    userId: true,
                    role: true,
                    user: {
                        select: {
                            email: true
                        }
                    }
                }
            }
        }
    })

    if (!org) throw new Not_Found("Org not found");

    let admin = false, user_found = false, userId: string|null = null;
    org.members.forEach(x =>
    {
        if (x.userId === req.id && x.role === "admin") admin = true;
        else if (x.user.email == result2.data.email)
        {
            user_found = true;
            userId = x.userId;

            if (x.role == result2.data.role)
                throw new Duplicate(`User already ${x.role}`)
        }
    })

    if (!admin) throw new Forbidden("Admin access required");
    if (!user_found) throw new Not_Found("User not a member");


    await prisma.membership.update({
        where: {
            userId_orgId: {
                userId: userId!,
                orgId: result.data.orgId
            }
        },
        data: {
            role: result2.data.role
        }
    })

    return res.status(201).json({
        success: true,
        data: "role updated"
    })
}
