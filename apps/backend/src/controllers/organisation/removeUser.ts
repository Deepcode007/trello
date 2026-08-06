import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function deleteUserHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.email()
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
            },
            _count: {
                select: {
                    members: {
                        where: {
                            role: "admin",
                            accepted: true
                        }
                    }
                }
            }
        }
    })

    if (!org) throw new Not_Found("Org not found");


    let admin = org.members.find(x => (x.userId == req.id && x.role == "admin"));
    let user_found = org.members.find(x => x.user.email === result2.data.email);

    if (!user_found) throw new Not_Found("User not a member");
    if (user_found.userId == req.id) admin = user_found;

    if (!admin) throw new Forbidden("Admin access required");

    // self leaving admin or removing an admin (allow if more admins exist)
    if (user_found.role == "admin" && org._count.members <= 1)
    {
        throw new Forbidden("No more admins left");
    }

    await prisma.membership.delete({
        where: {
            userId_orgId: {
                userId: user_found.userId,
                orgId: result.data.orgId
            }
        }
    })

    return res.status(200).json({
        success: true,
        data: "user deleted"
    })
}
