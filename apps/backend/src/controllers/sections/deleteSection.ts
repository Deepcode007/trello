import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function deleteSection(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            boardId: true,
            board: {
                select: {
                    org: {
                        select: {
                            id: true,
                            members: {
                                where: {
                                    userId: req.id,
                                    role: "admin",
                                    accepted: true
                                }
                            }
                        }
                    }
                }
            },
            _count: {
                select: {
                    issues: {
                        where: {
                            sectionId: result.data.sectionId
                        }
                    }
                }
            }
        }
    })

    if (!user) throw new Not_Found("Section not found");
    if (user.board.org.members.length === 0) throw new Forbidden("Admin access required");

    const issueCount = user._count.issues;
    const rawTarget = req.query.targetSectionId ?? (req.body && typeof req.body === "object" ? req.body.targetSectionId : undefined);
    const targetSectionId = typeof rawTarget === "string" ? rawTarget.trim() : undefined;

    if (issueCount > 0)
    {
        if (!targetSectionId)
        {
            throw new ValidationError("targetSectionId is required to reassign issues when deleting a non-empty section");
        }

        if (targetSectionId === result.data.sectionId)
        {
            throw new ValidationError("targetSectionId cannot be the same section being deleted");
        }

        const targetSection = await prisma.sections.findUnique({
            where: { id: targetSectionId },
            select: { id: true, boardId: true, title: true }
        });

        if (!targetSection || targetSection.boardId !== user.boardId)
        {
            throw new ValidationError("targetSectionId does not exist on this board");
        }
    }

    const { result: deletedSection } = await wsBroadcaster.executeWithOutbox(user.boardId, (outcome: any) => [
        ...outcome.reassignedIssues.map((issue: { id: string; position: number | null }) => ({
            type: "card:moved",
            payload: {
                cardId: issue.id,
                sourceList: result.data.sectionId,
                destList: targetSectionId,
                position: issue.position ?? 0
            }
        })),
        { type: "list:deleted", payload: { listId: result.data.sectionId } }
    ], async tx =>
    {
        const reassignedIssues = issueCount > 0 && targetSectionId
            ? await tx.issues.findMany({ where: { sectionId: result.data.sectionId }, select: { id: true, position: true } })
            : [];
        if (reassignedIssues.length > 0 && targetSectionId)
        {
            await tx.issues.updateMany({
                where: { sectionId: result.data.sectionId },
                data: { sectionId: targetSectionId }
            });
        }
        const deleted = await tx.sections.delete({ where: { id: result.data.sectionId } });
        return { title: deleted.title, reassignedIssues };
    });

    const actionText = issueCount > 0
        ? `deleted section: ${deletedSection.title} and reassigned ${issueCount} issues`
        : `deleted section: ${deletedSection.title}`;

    const orgId = user.board?.org?.id;
    let columnCount = await prisma.sections.count({
        where: { boardId: user.boardId }
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
                type: "user:org_board_columns_changed",
                payload: {
                    orgId,
                    boardId: user.boardId,
                    columnCount
                }
            });
        } catch (err)
        {
            console.warn("[deleteSection] Failed to dispatch column count changed event:", err);
        }
    }

    return res.status(200).json({
        success: true,
        data: actionText
    });
}
