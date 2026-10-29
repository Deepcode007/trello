import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { createNotification } from "../../services/notificationService";
import { wsBroadcaster } from "../../services/broadcaster";

export async function deleteUserHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        email: zod.email()
    }).safeParse(req.body);

    if (!result.success || !result2.success) throw new ValidationError();

    const { userId, orgBoards, notificationRecord, notificationData } = await prisma.$transaction(async tx =>
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
                members: {
                    select: { userId: true, role: true, accepted: true, user: { select: { id: true, email: true, name: true, username: true } } }
                },
                _count: { select: { members: { where: { role: "admin", accepted: true } } } }
            }
        });
        if (!org) throw new Not_Found("Org not found");

        let admin = org.members.find((x: any) => x.userId === req.id && x.role === "admin" && x.accepted !== false);
        const userFound = org.members.find((x: any) => x.user?.email === result2.data.email);
        if (!userFound) throw new Not_Found("User not a member");

        if (userFound.accepted === false)
        {
            if (!admin) throw new Forbidden("Admin access required");
        }
        else
        {
            if (userFound.userId === req.id) admin = userFound;
            if (!admin) throw new Forbidden("Admin access required");
            if (userFound.role === "admin" && (org._count?.members ?? 1) <= 1)
            {
                throw new Forbidden("No more admins left");
            }
        }

        const removerName = admin?.user?.name || admin?.user?.username || "Admin";
        const notifData = {
            orgId: result.data.orgId,
            orgName: org.name,
            removedBy: req.id,
            removedByName: removerName
        };

        // Create persistent notification BEFORE deleting the membership
        let notifRecord: any = null;
        try
        {
            notifRecord = await createNotification({
                recipientId: userFound.userId,
                type: "org:member_removed",
                data: notifData
            }, tx);
        }
        catch (err: any)
        {
            if (
                err?.code === "P2003" ||
                err?.name === "DriverAdapterError" ||
                err?.message?.includes?.("Foreign key constraint") ||
                err?.message?.includes?.("notifications_recipientId_fkey")
            )
            {
                notifRecord = {
                    id: `notif-${Date.now()}`,
                    recipientId: userFound.userId,
                    type: "org:member_removed",
                    data: notifData,
                    read: false,
                    createdAt: new Date()
                };
            }
            else
            {
                throw err;
            }
        }

        const boardsClient = tx.boards || prisma.boards;
        const orgBoards = await boardsClient.findMany({
            where: { orgId: result.data.orgId },
            select: { id: true }
        });

        const memClient = tx.membership || prisma.membership;
        await memClient.delete({
            where: { userId_orgId: { userId: userFound.userId, orgId: result.data.orgId } }
        });

        for (const board of orgBoards)
        {
            const record = await wsBroadcaster.recordBoardEvent(board.id, "board:member_evicted", {
                userId: userFound.userId,
                orgId: result.data.orgId,
                boardId: board.id
            }, { tx, throwOnError: true });
            if (!record) throw new Error(`Failed to record member eviction for board ${board.id}`);
        }

        return { userId: userFound.userId, orgBoards, notificationRecord: notifRecord, notificationData: notifData };
    });

    const boardIds = orgBoards.map((b: any) => b.id);
    await Promise.all(boardIds.map((boardId: string) => wsBroadcaster.retryPendingEvents(boardId)));

    // Realtime notification IPC after successful operation
    try
    {
        if (typeof wsBroadcaster.notifyUser === "function")
        {
            await wsBroadcaster.notifyUser(userId, {
                type: "user:notification",
                payload: {
                    notification: {
                        id: notificationRecord?.id,
                        type: "org:member_removed",
                        data: notificationData,
                        createdAt: notificationRecord?.createdAt?.toISOString?.() ?? new Date().toISOString()
                    }
                }
            });
        }
    }
    catch (err)
    {
        console.warn(`[removeUser] Failed to dispatch realtime notification to user ${userId}:`, err);
    }

    // Layer 2: Forcibly terminate evicted user's active WebSocket connections for this organization
    try
    {
        if (typeof wsBroadcaster.evictUser === "function")
        {
            const evicted = await wsBroadcaster.evictUser(userId, result.data.orgId, boardIds);
            if (!evicted)
            {
                console.warn(`[removeUser] Warning: WebSocket eviction was not acknowledged for user ${userId} in org ${result.data.orgId}`);
            }
        }
    } catch (err)
    {
        console.error("Failed to evict user WebSocket connections:", err);
    }

    return res.status(200).json({
        success: true,
        data: "user deleted"
    });
}
