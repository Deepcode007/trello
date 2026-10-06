import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import { wsBroadcaster } from "../../services/broadcaster";

export async function createLabel(req: Request, res: Response) {
    const paramResult = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    const bodyResult = zod.object({
        name: zod.string().trim().min(1),
        color: zod.string().trim().min(1)
    }).safeParse(req.body);

    if (!paramResult.success || !bodyResult.success) {
        throw new ValidationError();
    }

    const board = await prisma.boards.findUnique({
        where: { id: paramResult.data.boardId },
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
    });

    if (!board) throw new Not_Found("Board not found");
    if (board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    const label = await prisma.labels.create({
        data: {
            boardId: paramResult.data.boardId,
            name: bodyResult.data.name,
            color: bodyResult.data.color
        }
    });

    wsBroadcaster.broadcast(paramResult.data.boardId, {
        type: "label:created",
        payload: { label }
    });

    return res.status(201).json({
        success: true,
        data: label
    });
}

export async function getLabels(req: Request, res: Response) {
    const paramResult = zod.object({
        boardId: zod.uuid()
    }).safeParse(req.params);

    if (!paramResult.success) throw new ValidationError();

    const board = await prisma.boards.findUnique({
        where: { id: paramResult.data.boardId },
        select: {
            org: {
                select: {
                    members: {
                        where: {
                            userId: req.id,
                            accepted: true
                        }
                    }
                }
            }
        }
    });

    if (!board) throw new Not_Found("Board not found");
    if (board.org.members.length === 0) throw new Forbidden("Members only");

    const labels = await prisma.labels.findMany({
        where: { boardId: paramResult.data.boardId },
        orderBy: { createdAt: "asc" }
    });

    return res.status(200).json({
        success: true,
        data: labels
    });
}

export async function attachLabel(req: Request, res: Response) {
    const paramResult = zod.object({
        issueId: zod.uuid()
    }).safeParse(req.params);

    const bodyResult = zod.object({
        labelId: zod.uuid()
    }).safeParse(req.body);

    if (!paramResult.success || !bodyResult.success) throw new ValidationError();

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

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    const label = await prisma.labels.findUnique({
        where: { id: bodyResult.data.labelId }
    });
    if (!label || label.boardId !== issue.boardId) throw new ValidationError("Label does not belong to this board");

    const assignment = await prisma.issue_labels.upsert({
        where: {
            issueId_labelId: {
                issueId: paramResult.data.issueId,
                labelId: bodyResult.data.labelId
            }
        },
        create: {
            issueId: paramResult.data.issueId,
            labelId: bodyResult.data.labelId
        },
        update: {}
    });

    wsBroadcaster.broadcast(issue.boardId, {
        type: "card:label_added",
        payload: { issueId: paramResult.data.issueId, label }
    });

    return res.status(201).json({
        success: true,
        data: assignment
    });
}

export async function detachLabel(req: Request, res: Response) {
    const paramResult = zod.object({
        issueId: zod.uuid(),
        labelId: zod.uuid()
    }).safeParse(req.params);

    if (!paramResult.success) throw new ValidationError();

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

    if (!issue) throw new Not_Found("Issue not found");
    if (issue.board.org.members.length === 0) throw new Forbidden("Admin/Employee access required");

    await prisma.issue_labels.deleteMany({
        where: {
            issueId: paramResult.data.issueId,
            labelId: paramResult.data.labelId
        }
    });

    wsBroadcaster.broadcast(issue.boardId, {
        type: "card:label_removed",
        payload: { issueId: paramResult.data.issueId, labelId: paramResult.data.labelId }
    });

    return res.status(200).json({
        success: true,
        data: "Label removed from card"
    });
}
