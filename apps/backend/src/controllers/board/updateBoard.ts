import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function updateBoard(req: Request, res: Response)
{
    const result = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim().min(1).optional(),
        description: zod.string().optional(),
        color: zod.string().optional(),
        isArchived: zod.boolean().optional()
    }).refine(data => data.title !== undefined || data.description !== undefined || data.color !== undefined || data.isArchived !== undefined, {
        message: "At least one field must be provided"
    }).safeParse(req.body);

    if (!result.success || !result2.success) throw new ValidationError();

    const user = await prisma.boards.findUnique({
        where: {
            id: result.data.boardId
        },
        select: {
            orgId: true,
            org: {
                select: {
                    id: true,
                    members: {
                        where: {
                            accepted: true,
                            userId: req.id,
                            role: {
                                in: ["admin", "employee"]
                            }
                        }
                    }
                }
            }
        }
    })

    if (!user) throw new Not_Found("Board not found/invalid Board Id");
    if (user.org.members.length == 0) throw new Forbidden("Admin/Employee access only");

    const { result: board } = await wsBroadcaster.executeWithOutbox(result.data.boardId, updated => ({
        type: "board:updated",
        payload: { boardId: updated.id, title: updated.title, description: updated.description, color: updated.color, isArchived: updated.isArchived }
    }), tx => tx.boards.update({ where: { id: result.data.boardId }, data: result2.data }));

    const orgId = user.orgId;
    let memberUserIds: string[] = [];

    const acceptedMembers = await prisma.membership.findMany({
        where: { orgId, accepted: true },
        select: { userId: true }
    });

    memberUserIds = acceptedMembers.map((m: any) => m.userId).filter(Boolean);

    if (memberUserIds.length > 0)
    {
        try
        {
            await wsBroadcaster.notifyUsers(memberUserIds, {
                type: "user:org_board_updated",
                payload: {
                    orgId,
                    boardId: (board as any).id,
                    board,
                    changes: {
                        title: (board as any).title,
                        description: (board as any).description,
                        color: (board as any).color,
                        isArchived: (board as any).isArchived,
                        updatedAt: (board as any).updatedAt ? (board as any).updatedAt.toISOString() : undefined
                    }
                }
            });
        } catch (err)
        {
            console.warn("[updateBoard] Failed to dispatch org board updated event:", err);
        }
    }

    return res.status(200).json({
        success: true,
        data: board
    })
}
