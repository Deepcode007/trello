import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
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

    const { userId, orgBoards } = await prisma.$transaction(async tx =>
    {
        if (typeof tx.$queryRaw === "function")
        {
            await tx.$queryRaw`WITH advisory_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock(hashtext(${result.data.orgId}))
            )
            SELECT 1::int AS locked FROM advisory_lock`;
        }

        const org = await tx.orgs.findUnique({
            where: { id: result.data.orgId },
            select: {
                members: {
                    select: { userId: true, role: true, accepted: true, user: { select: { email: true } } }
                },
                _count: { select: { members: { where: { role: "admin", accepted: true } } } }
            }
        });
        if (!org) throw new Not_Found("Org not found");

        let admin = org.members.find(x => x.userId === req.id && x.role === "admin" && x.accepted !== false);
        const userFound = org.members.find(x => x.user.email === result2.data.email);
        if (!userFound) throw new Not_Found("User not a member");

        if (userFound.accepted === false)
        {
            if (!admin) throw new Forbidden("Admin access required");
        }
        else
        {
            if (userFound.userId === req.id) admin = userFound;
            if (!admin) throw new Forbidden("Admin access required");
            if (userFound.role === "admin" && org._count.members <= 1)
            {
                throw new Forbidden("No more admins left");
            }
        }

        const orgBoards = await tx.boards.findMany({
            where: { orgId: result.data.orgId },
            select: { id: true }
        });
        await tx.membership.delete({
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

        return { userId: userFound.userId, orgBoards };
    });

    const boardIds = orgBoards.map(b => b.id);
    await Promise.all(boardIds.map(boardId => wsBroadcaster.retryPendingEvents(boardId)));

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
    })
}
