import { prisma } from "db/prisma";
import type { Request, Response } from "express";
import zod from "zod";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function getBoardEvents(req: Request, res: Response) {
    const boardIdParam = req.params.boardId ?? req.params.id;
    const paramResult = zod.object({
        boardId: zod.uuid()
    }).safeParse({ boardId: boardIdParam });

    const queryResult = zod.object({
        sinceSeq: zod.string().optional().transform(val => val ? BigInt(val) : 0n),
        limit: zod.string().optional().transform(val => val ? Math.min(Math.max(Number(val), 1), 500) : 100)
    }).safeParse(req.query);

    if (!paramResult.success || !queryResult.success) {
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
                            accepted: true
                        }
                    }
                }
            }
        }
    });

    if (!board) throw new Not_Found("Board not found");
    if (board.org.members.length === 0) throw new Forbidden("Members only");

    const events = await prisma.board_events.findMany({
        where: {
            boardId: paramResult.data.boardId,
            sequence: {
                gt: queryResult.data.sinceSeq
            }
        },
        orderBy: {
            sequence: "asc"
        },
        take: queryResult.data.limit
    });

    const serializedEvents = events.map(e => ({
        ...e,
        sequence: e.sequence.toString()
    }));

    return res.status(200).json({
        success: true,
        data: serializedEvents
    });
}
