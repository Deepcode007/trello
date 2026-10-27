import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Duplicate, Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { createBulkNotifications } from "../../services/notificationService";
import { wsBroadcaster } from "../../services/broadcaster";

export async function acceptInviteHandler(req: Request, res: Response)
{
    const result1 = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!result1.success)
    {
        throw new ValidationError();
    }

    let adminUserIds: string[] = [];
    let notificationData: any = null;

    await prisma.$transaction(async tx =>
    {
        if (typeof tx.$queryRaw === "function")
        {
            await tx.$queryRaw`WITH advisory_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtext(${result1.data.orgId}))
            )
            SELECT 1::int AS locked FROM advisory_lock`;
        }

        const orgClient = tx.orgs || prisma.orgs;
        const org = await orgClient.findUnique({
            where: {
                id: result1.data.orgId
            },
            select: {
                id: true,
                name: true,
                members: {
                    select: {
                        userId: true,
                        role: true,
                        accepted: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                email: true
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

        const currentMember = org.members.find((m: any) => m.userId === req.id);
        if (!currentMember) throw new Forbidden("User not invited");
        if (currentMember.accepted === true) throw new Duplicate("User already member");

        const memClient = tx.membership || prisma.membership;
        await memClient.update({
            where: {
                userId_orgId: {
                    userId: req.id,
                    orgId: result1.data.orgId
                }
            },
            data: {
                accepted: true
            }
        });

        // Filter all accepted organization admins (excluding accepting user)
        const adminMembers = org.members.filter(
            (m: any) => m.role === "admin" && m.accepted === true && m.userId !== req.id
        );
        adminUserIds = adminMembers.map((m: any) => m.userId);

        const acceptingUserName = currentMember.user?.name || currentMember.user?.username || currentMember.user?.email || "User";
        notificationData = {
            orgId: result1.data.orgId,
            orgName: org.name,
            userId: req.id,
            userName: acceptingUserName
        };

        if (adminUserIds.length > 0)
        {
            const notifItems = adminUserIds.map((adminId: string) => ({
                recipientId: adminId,
                type: "org:invitation_accepted",
                data: notificationData
            }));
            await createBulkNotifications(notifItems, tx);
        }
    });

    // Realtime notification IPC after successful commit
    if (adminUserIds.length > 0)
    {
        try
        {
            if (typeof wsBroadcaster.notifyUsers === "function")
            {
                await wsBroadcaster.notifyUsers(adminUserIds, {
                    type: "user:notification",
                    payload: {
                        notification: {
                            type: "org:invitation_accepted",
                            data: notificationData,
                            createdAt: new Date().toISOString()
                        }
                    }
                });
            }
        }
        catch (err)
        {
            console.warn("[acceptInvite] Failed to dispatch realtime notifications to admins:", err);
        }
    }

    return res.status(200).json({
        success: true,
        data: "accepted"
    });
}
