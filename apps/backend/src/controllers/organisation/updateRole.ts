import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { createNotification } from "../../services/notificationService";
import { wsBroadcaster } from "../../services/broadcaster";

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

    let affectedUserId = "";
    let notificationData: any = null;
    let notificationRecord: any = null;

    await prisma.$transaction(async tx =>
    {
        if (typeof tx.$queryRaw === "function")
        {
            await tx.$queryRaw`WITH advisory_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtext(${result.data.orgId}))
            )
            SELECT 1::int AS locked FROM advisory_lock`;
        }

        const orgClient = tx.orgs || prisma.orgs;
        const org = await orgClient.findUnique({
            where: { id: result.data.orgId },
            select: {
                id: true,
                name: true,
                _count: { select: { members: { where: { role: "admin", accepted: true } } } },
                members: {
                    where: { accepted: true },
                    select: {
                        userId: true,
                        role: true,
                        user: { select: { id: true, email: true, name: true, username: true } }
                    }
                }
            }
        });
        if (!org) throw new Not_Found("Org not found");

        const requesterMember = org.members.find((m: any) => m.userId === req.id && m.role === "admin");
        if (!requesterMember) throw new Forbidden("Admin access required");

        const targetMember = org.members.find((m: any) => m.user?.email === result2.data.email);
        if (!targetMember) throw new Not_Found("User not a member");
        if (targetMember.role === result2.data.role) throw new Duplicate(`User already ${targetMember.role}`);
        if (targetMember.role === "admin" && result2.data.role !== "admin" && (org._count?.members ?? 1) <= 1)
        {
            throw new Forbidden("Cannot demote the last remaining admin");
        }

        affectedUserId = targetMember.userId;

        const memClient = tx.membership || prisma.membership;
        await memClient.update({
            where: { userId_orgId: { userId: targetMember.userId, orgId: result.data.orgId } },
            data: { role: result2.data.role }
        });

        const changerName = requesterMember.user?.name || requesterMember.user?.username || "Admin";
        notificationData = {
            orgId: result.data.orgId,
            orgName: org.name,
            oldRole: targetMember.role,
            newRole: result2.data.role,
            changedBy: req.id,
            changedByName: changerName
        };

        notificationRecord = await createNotification({
            recipientId: targetMember.userId,
            type: "org:role_changed",
            data: notificationData
        }, tx);
    });

    // Realtime notification IPC after successful commit
    try
    {
        if (typeof wsBroadcaster.notifyUser === "function")
        {
            await wsBroadcaster.notifyUser(affectedUserId, {
                type: "user:notification",
                payload: {
                    notification: {
                        id: notificationRecord?.id,
                        type: "org:role_changed",
                        data: notificationData,
                        createdAt: notificationRecord?.createdAt?.toISOString?.() ?? new Date().toISOString()
                    }
                }
            });
        }
    }
    catch (err)
    {
        console.warn(`[updateRole] Failed to dispatch realtime notification to user ${affectedUserId}:`, err);
    }

    // WebSocket membership-cache update IPC required by SEC-4
    try
    {
        if (typeof wsBroadcaster.updateUserRole === "function")
        {
            await wsBroadcaster.updateUserRole(affectedUserId, result.data.orgId, result2.data.role);
        }
    }
    catch (err)
    {
        console.warn(`[updateRole] Failed to update WebSocket role cache for user ${affectedUserId}:`, err);
    }

    return res.status(201).json({
        success: true,
        data: "role updated"
    });
}
