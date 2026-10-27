import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { createNotification } from "../../services/notificationService";
import { wsBroadcaster } from "../../services/broadcaster";

export async function inviteUserHandler(req: Request, res: Response)
{
    const result1 = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.email(),
        role: zod.enum(["admin", "employee", "contributor"]).optional().default("contributor")
    }).safeParse(req.body);

    if (!result1.success || !result2.success)
    {
        throw new ValidationError();
    }

    let invitedUserId = "";
    let notificationData: any = null;
    let notificationRecord: any = null;

    await prisma.$transaction(async tx =>
    {
        if (typeof tx.$queryRaw === "function")
        {
            await tx.$queryRaw`WITH advisory_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtext(${result1.data.orgId}))
            )
            SELECT 1::int AS locked FROM advisory_lock`;
        }

        const userClient = tx.user || prisma.user;
        const user2 = await userClient.findUnique({
            where: {
                email: result2.data.email
            },
            select: {
                id: true,
                email: true,
                name: true,
                username: true
            }
        });

        if (!user2)
        {
            throw new Not_Found("User not signed up");
        }
        invitedUserId = user2.id;

        const orgClient = tx.orgs || prisma.orgs;
        const org = await orgClient.findUnique({
            where: {
                id: result1.data.orgId,
            },
            select: {
                id: true,
                name: true,
                members: {
                    select: {
                        role: true,
                        accepted: true,
                        userId: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true
                            }
                        }
                    }
                }
            }
        });

        if (!org)
        {
            throw new Not_Found("Org not found");
        }

        let admin = false, member = false, invited = false;
        let inviterMember: any = null;

        org.members.forEach((x: any) =>
        {
            if (x.userId == req.id && x.role === "admin" && x.accepted)
            {
                admin = true;
                inviterMember = x;
            }
            if (x.userId == user2.id)
            {
                if (x.accepted) member = true;
                else invited = true;
            }
        });

        if (!admin) throw new Forbidden("Admin access required");
        if (member) throw new Duplicate("User already member");
        if (invited) throw new Duplicate("User already invited");

        const memClient = tx.membership || prisma.membership;
        await memClient.create({
            data: {
                userId: user2.id,
                orgId: result1.data.orgId,
                role: result2.data.role,
                accepted: false
            }
        });

        const inviterName = inviterMember?.user?.name || inviterMember?.user?.username || "Admin";
        notificationData = {
            orgId: result1.data.orgId,
            orgName: org.name,
            invitedBy: req.id,
            invitedByName: inviterName,
            role: result2.data.role
        };

        notificationRecord = await createNotification({
            recipientId: user2.id,
            type: "org:invitation_received",
            data: notificationData
        }, tx);
    });

    // Realtime notification IPC after successful commit
    try
    {
        if (typeof wsBroadcaster.notifyUser === "function")
        {
            await wsBroadcaster.notifyUser(invitedUserId, {
                type: "user:notification",
                payload: {
                    notification: {
                        id: notificationRecord?.id,
                        type: "org:invitation_received",
                        data: notificationData,
                        createdAt: notificationRecord?.createdAt ? notificationRecord.createdAt.toISOString() : new Date().toISOString()
                    }
                }
            });
        }
    }
    catch (err)
    {
        console.warn(`[addUser] Failed to dispatch realtime notification to user ${invitedUserId}:`, err);
    }

    return res.status(201).json({
        success: true,
        data: "invited"
    });
}
