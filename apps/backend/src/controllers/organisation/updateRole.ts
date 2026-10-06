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
        role: zod.enum(["admin", "employee", "contributor"])
    }).safeParse(req.body);

    if (!result.success || !result2.success) throw new ValidationError();

    const org = await prisma.orgs.findUnique({
        where: {
            id: result.data.orgId
        },
        select: {
            _count: {
                select: {
                    members: {
                        where: { role: "admin", accepted: true }
                    }
                }
            },
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
    });

    if (!org) throw new Not_Found("Org not found");

    const isRequesterAdmin = org.members.some(m => m.userId === req.id && m.role === "admin");
    if (!isRequesterAdmin) throw new Forbidden("Admin access required");

    const targetMember = org.members.find(m => m.user.email === result2.data.email);
    if (!targetMember) throw new Not_Found("User not a member");

    if (targetMember.role === result2.data.role) {
        throw new Duplicate(`User already ${targetMember.role}`);
    }

    // Guard against demoting the last active administrator
    if (targetMember.role === "admin" && result2.data.role !== "admin" && org._count.members <= 1) {
        throw new Forbidden("Cannot demote the last remaining admin");
    }

    await prisma.membership.update({
        where: {
            userId_orgId: {
                userId: targetMember.userId,
                orgId: result.data.orgId
            }
        },
        data: {
            role: result2.data.role
        }
    });

    return res.status(201).json({
        success: true,
        data: "role updated"
    });
}
