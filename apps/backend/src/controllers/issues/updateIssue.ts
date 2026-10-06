import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function updateIssue(req: Request, res: Response)
{
    const issueIdParam = req.params.issueId ?? req.params.cardId ?? req.params.id;
    const result = zod.object({
        issueId: zod.uuid()
    }).safeParse({ issueId: issueIdParam });

    const result2 = zod.object({
        title: zod.string().optional(),
        sectionId: zod.uuid().optional(),
        destList: zod.uuid().optional(),
        gh_url: zod.string().optional(),
        position: zod.number().optional(),
        description: zod.string().optional(),
        priority: zod.enum(["low", "medium", "high", "urgent"]).optional(),
        dueDate: zod.string().datetime().nullable().optional().transform(d => d ? new Date(d) : d === null ? null : undefined),
        startDate: zod.string().datetime().nullable().optional().transform(d => d ? new Date(d) : d === null ? null : undefined),
        isArchived: zod.boolean().optional()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const targetSectionId = result2.data.sectionId ?? result2.data.destList;

    const issue = await prisma.issues.findUnique({
        where: {
            id: result.data.issueId
        },
        select: {
            boardId: true,
            sectionId: true,
            board: {
                select: {
                    org: {
                        select: {
                            members: {
                                where: {
                                    userId: req.id,
                                    accepted: true,
                                    role: {
                                        in: ["admin", "employee"]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access only");

    if (targetSectionId)
    {
        const section = await prisma.sections.findUnique({
            where: { id: targetSectionId },
            select: { boardId: true }
        });
        if (!section) throw new Not_Found("Section not found");
        if (section.boardId !== issue.boardId) throw new ValidationError("Section belongs to a different board");
    }

    const updateData: {
        title?: string;
        sectionId?: string;
        gh_url?: string;
        position?: number;
        description?: string;
        priority?: "low" | "medium" | "high" | "urgent";
        dueDate?: Date | null;
        startDate?: Date | null;
        isArchived?: boolean;
    } = {};

    if (result2.data.title !== undefined) updateData.title = result2.data.title;
    if (targetSectionId !== undefined) updateData.sectionId = targetSectionId;
    if (result2.data.gh_url !== undefined) updateData.gh_url = result2.data.gh_url;
    if (result2.data.position !== undefined) updateData.position = result2.data.position;
    if (result2.data.description !== undefined) updateData.description = result2.data.description;
    if (result2.data.priority !== undefined) updateData.priority = result2.data.priority;
    if (result2.data.dueDate !== undefined) updateData.dueDate = result2.data.dueDate;
    if (result2.data.startDate !== undefined) updateData.startDate = result2.data.startDate;
    if (result2.data.isArchived !== undefined) updateData.isArchived = result2.data.isArchived;

    const updated = await prisma.issues.update({
        where: {
            id: result.data.issueId
        },
        data: updateData
    })

    const reqPath = req.originalUrl || req.path || req.url || "";
    const isMove = result2.data.position !== undefined ||
        (targetSectionId !== undefined && targetSectionId !== issue.sectionId) ||
        Boolean(reqPath && reqPath.includes("/move"));

    const isEdit = result2.data.title !== undefined ||
        result2.data.gh_url !== undefined ||
        result2.data.description !== undefined ||
        result2.data.priority !== undefined ||
        result2.data.dueDate !== undefined ||
        result2.data.startDate !== undefined ||
        result2.data.isArchived !== undefined;

    if (isMove) {
        wsBroadcaster.broadcastCardMoved(issue.boardId, {
            cardId: updated.id,
            sourceList: issue.sectionId,
            destList: targetSectionId ?? issue.sectionId,
            position: result2.data.position ?? 0
        });
    }

    if (isEdit) {
        const editUpdates: Record<string, unknown> = {};
        if (result2.data.title !== undefined) editUpdates.title = result2.data.title;
        if (result2.data.gh_url !== undefined) editUpdates.gh_url = result2.data.gh_url;
        if (result2.data.description !== undefined) editUpdates.description = result2.data.description;
        if (result2.data.priority !== undefined) editUpdates.priority = result2.data.priority;
        if (result2.data.dueDate !== undefined) editUpdates.dueDate = result2.data.dueDate;
        if (result2.data.startDate !== undefined) editUpdates.startDate = result2.data.startDate;
        if (result2.data.isArchived !== undefined) editUpdates.isArchived = result2.data.isArchived;
        wsBroadcaster.broadcastCardUpdated(issue.boardId, updated.id, editUpdates);
    }

    return res.status(200).json({
        success: true,
        data: updated
    })
}
