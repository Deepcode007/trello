import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function createChecklist(req: Request, res: Response) {
    const paramResult = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    const bodyResult = zod.object({
        title: zod.string().trim().min(1)
    }).safeParse(req.body);

    if (!paramResult.success || !bodyResult.success) {
        throw new ValidationError();
    }

    const issue = await prisma.issues.findUnique({
        where: { id: paramResult.data.issueId },
        select: {
            boardId: true,
            board: {
                select: {
                    org: {
                        select: {
                            members: {
                                where: {
                                    userId: req.id,
                                    accepted: true,
                                    role: { in: ["admin", "employee"] }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!issue) throw new Not_Found("Card not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    const count = await prisma.checklists.count({
        where: { issueId: paramResult.data.issueId }
    });

    const checklist = await prisma.checklists.create({
        data: {
            issueId: paramResult.data.issueId,
            title: bodyResult.data.title,
            position: (count + 1) * 1000
        },
        include: {
            items: true
        }
    });

    wsBroadcaster.broadcast(issue.boardId, {
        type: "checklist:created",
        payload: { issueId: paramResult.data.issueId, checklist }
    });

    return res.status(201).json({
        success: true,
        data: checklist
    });
}

export async function addChecklistItem(req: Request, res: Response) {
    const paramResult = zod.object({
        checklistId: zod.uuid()
    }).safeParse(req.params);

    const bodyResult = zod.object({
        content: zod.string().trim().min(1),
        dueDate: zod.string().datetime().optional().transform(d => d ? new Date(d) : undefined)
    }).safeParse(req.body);

    if (!paramResult.success || !bodyResult.success) {
        throw new ValidationError();
    }

    const checklist = await prisma.checklists.findUnique({
        where: { id: paramResult.data.checklistId },
        select: {
            id: true,
            issueId: true,
            issue: {
                select: {
                    boardId: true,
                    board: {
                        select: {
                            org: {
                                select: {
                                    members: {
                                        where: {
                                            userId: req.id,
                                            accepted: true,
                                            role: { in: ["admin", "employee"] }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!checklist) throw new Not_Found("Checklist not found");
    if (checklist.issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    const count = await prisma.checklist_items.count({
        where: { checklistId: paramResult.data.checklistId }
    });

    const item = await prisma.checklist_items.create({
        data: {
            checklistId: paramResult.data.checklistId,
            content: bodyResult.data.content,
            dueDate: bodyResult.data.dueDate,
            position: (count + 1) * 1000
        }
    });

    wsBroadcaster.broadcast(checklist.issue.boardId, {
        type: "checklist_item:created",
        payload: { checklistId: paramResult.data.checklistId, item }
    });

    return res.status(201).json({
        success: true,
        data: item
    });
}

export async function updateChecklistItem(req: Request, res: Response) {
    const paramResult = zod.object({
        itemId: zod.uuid()
    }).safeParse(req.params);

    const bodyResult = zod.object({
        content: zod.string().trim().min(1).optional(),
        isCompleted: zod.boolean().optional(),
        dueDate: zod.string().datetime().nullable().optional().transform(d => d ? new Date(d) : d === null ? null : undefined)
    }).safeParse(req.body);

    if (!paramResult.success || !bodyResult.success) throw new ValidationError();

    const item = await prisma.checklist_items.findUnique({
        where: { id: paramResult.data.itemId },
        select: {
            id: true,
            checklistId: true,
            checklist: {
                select: {
                    issue: {
                        select: {
                            boardId: true,
                            board: {
                                select: {
                                    org: {
                                        select: {
                                            members: {
                                                where: {
                                                    userId: req.id,
                                                    accepted: true,
                                                    role: { in: ["admin", "employee"] }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!item) throw new Not_Found("Checklist item not found");
    if (item.checklist.issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    const updated = await prisma.checklist_items.update({
        where: { id: paramResult.data.itemId },
        data: bodyResult.data
    });

    wsBroadcaster.broadcast(item.checklist.issue.boardId, {
        type: "checklist_item:updated",
        payload: { itemId: updated.id, checklistId: item.checklistId, item: updated }
    });

    return res.status(200).json({
        success: true,
        data: updated
    });
}

export async function deleteChecklist(req: Request, res: Response) {
    const paramResult = zod.object({
        checklistId: zod.uuid()
    }).safeParse(req.params);

    if (!paramResult.success) throw new ValidationError();

    const checklist = await prisma.checklists.findUnique({
        where: { id: paramResult.data.checklistId },
        select: {
            id: true,
            issueId: true,
            issue: {
                select: {
                    boardId: true,
                    board: {
                        select: {
                            org: {
                                select: {
                                    members: {
                                        where: {
                                            userId: req.id,
                                            accepted: true,
                                            role: { in: ["admin", "employee"] }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!checklist) throw new Not_Found("Checklist not found");
    if (checklist.issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    await prisma.checklists.delete({
        where: { id: paramResult.data.checklistId }
    });

    wsBroadcaster.broadcast(checklist.issue.boardId, {
        type: "checklist:deleted",
        payload: { issueId: checklist.issueId, checklistId: paramResult.data.checklistId }
    });

    return res.status(200).json({
        success: true,
        data: "Checklist deleted"
    });
}
