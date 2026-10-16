import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function renameSection(req: Request, res: Response)
{
    const result = zod.object({
        sectionId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string().trim().min(1).optional(),
        position: zod.number().optional(),
        newPosition: zod.number().optional(),
        wipLimit: zod.number().int().positive().nullable().optional(),
        isArchived: zod.boolean().optional()
    }).refine(data => data.title !== undefined || data.position !== undefined || data.newPosition !== undefined || data.wipLimit !== undefined || data.isArchived !== undefined, {
        message: "At least one update field is required"
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.sections.findUnique({
        where: {
            id: result.data.sectionId
        },
        select: {
            title: true,
            boardId: true,
            board: {
                select: {
                    org: {
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
                    }
                }
            }
        }
    });

    if (!user) throw new Not_Found("Invalid sectionId/Section Not found");
    if (user.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    const pos = result2.data.newPosition ?? result2.data.position;
    const updateData: { title?: string; position?: number; wipLimit?: number | null; isArchived?: boolean } = {};
    if (result2.data.title !== undefined) updateData.title = result2.data.title;
    if (pos !== undefined) updateData.position = pos;
    if (result2.data.wipLimit !== undefined) updateData.wipLimit = result2.data.wipLimit;
    if (result2.data.isArchived !== undefined) updateData.isArchived = result2.data.isArchived;

    const { result: section } = await wsBroadcaster.executeWithOutbox(user.boardId, updatedSection =>
    {
        const events = [];
        if (pos !== undefined)
        {
            events.push({ type: "list:reordered", payload: { listId: updatedSection.id, newPosition: pos } });
        }
        if (result2.data.title !== undefined || result2.data.wipLimit !== undefined || result2.data.isArchived !== undefined)
        {
            events.push({
                type: "list:updated",
                payload: { listId: updatedSection.id, title: updatedSection.title, wipLimit: updatedSection.wipLimit, isArchived: updatedSection.isArchived }
            });
        }
        return events;
    }, tx => tx.sections.update({ where: { id: result.data.sectionId }, data: updateData }));

    return res.status(200).json({
        success: true,
        data: section
    });
}
