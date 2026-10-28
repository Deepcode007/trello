import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function createIssue(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim().min(1),
        boardId: zod.uuid(),
        gh_url: zod.string().optional(),
        position: zod.number().optional(),
        description: zod.string().optional(),
        priority: zod.enum(["low", "medium", "high", "urgent"]).optional(),
        dueDate: zod.iso.datetime().optional().transform(d => d ? new Date(d) : undefined),
        startDate: zod.iso.datetime().optional().transform(d => d ? new Date(d) : undefined)
    }).safeParse(req.body);

    if (!result.success || !result2.success) throw new ValidationError();

    const user = await prisma.boards.findUnique({
        where: {
            id: result2.data.boardId
        },
        select: {
            orgId: true,
            org: {
                select: {
                    id: true,
                    members: {
                        where: {
                            userId: req.id,
                            accepted: true
                        }
                    }
                }
            }
        }
    })

    if (!user) throw new Not_Found("Board not found");
    if (user.org.members.length === 0) throw new Forbidden("Members only");

    const section = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            boardId: true
        }
    });

    if (!section) throw new Not_Found("Section not found");
    if (section.boardId !== result2.data.boardId)
    {
        throw new ValidationError("Section belongs to a different board");
    }

    let position = result2.data.position;
    if (position === undefined)
    {
        const lastIssue = await prisma.issues.findFirst({
            where: { sectionId: result.data.sectionId },
            orderBy: { position: "desc" },
            select: { position: true }
        });
        position = (lastIssue?.position ?? 0) + 1000;
    }

    const { result: issue } = await wsBroadcaster.executeWithOutbox(
        result2.data.boardId,
        created => ({ type: "card:created", payload: { cardData: created } }),
        tx => tx.issues.create({
            data: {
                ...result2.data,
                ...result.data,
                position
            }
        })
    );

    const orgId = user.orgId;
    let cardCount = await prisma.issues.count({
        where: { boardId: result2.data.boardId }
    });

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
                type: "user:org_board_cards_changed",
                payload: {
                    orgId,
                    boardId: result2.data.boardId,
                    cardCount
                }
            });
        } catch (err)
        {
            console.warn("[createIssue] Failed to dispatch card count changed event:", err);
        }
    }

    return res.status(201).json({
        success: true,
        data: issue
    })
}
