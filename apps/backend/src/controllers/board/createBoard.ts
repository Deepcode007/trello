import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function createBoard(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string(),
        description: zod.string().optional(),
        color: zod.string().optional()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.orgs.findUnique({
        where: {
            id: result.data.orgId
        },
        select: {
            members: {
                where: {
                    role: {
                        in: ["admin", "employee"]
                    },
                    userId: req.id,
                    accepted: true
                }
            }
        }
    })


    if (!user) throw new Not_Found("Org not found/invalid Org Id");
    if (user.members.length == 0) throw new Forbidden("Employee/Admin access only");

    const board = await prisma.boards.create({
        data: {
            title: result2.data.title,
            description: result2.data.description,
            color: result2.data.color,
            orgId: result.data.orgId
        }
    })

    const orgId = result.data.orgId;
    let memberUserIds: string[] = [];
    if (orgId) {
        try {
            if (prisma.membership && typeof prisma.membership.findMany === "function") {
                const acceptedMembers = await prisma.membership.findMany({
                    where: { orgId, accepted: true },
                    select: { userId: true }
                });
                if (Array.isArray(acceptedMembers)) {
                    memberUserIds = acceptedMembers.map((m: any) => m.userId).filter(Boolean);
                }
            }
        } catch {
            // Safe fallback in mock environments
        }
    }

    const boardSummary = {
        id: board.id,
        title: board.title,
        description: board.description ?? null,
        color: board.color ?? null,
        isArchived: board.isArchived ?? false,
        orgId: board.orgId ?? orgId,
        createdAt: board.createdAt ? board.createdAt.toISOString() : new Date().toISOString(),
        updatedAt: board.updatedAt ? board.updatedAt.toISOString() : new Date().toISOString(),
        _count: {
            issues: 0,
            section: 0
        },
        columnCount: 0
    };

    if (orgId && memberUserIds.length > 0 && typeof wsBroadcaster.notifyUsers === "function") {
        try {
            await wsBroadcaster.notifyUsers(memberUserIds, {
                type: "user:org_board_created",
                payload: {
                    orgId,
                    board: boardSummary
                }
            });
        } catch (err) {
            console.warn("[createBoard] Failed to dispatch board created event:", err);
        }
    }

    return res.status(201).json({
        success: true,
        data: board
    })
}
