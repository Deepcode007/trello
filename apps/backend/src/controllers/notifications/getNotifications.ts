import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Unauthorised, ValidationError } from "../../helpers/errorClass";

export async function getNotifications(req: Request, res: Response)
{
    if (!req.id)
    {
        throw new Unauthorised("User unauthorised");
    }

    const queryResult = zod.object({
        cursor: zod.string().trim().min(1).optional(),
        limit: zod.coerce.number().int().min(1).max(50).optional().default(20)
    }).safeParse(req.query);

    if (!queryResult.success)
    {
        throw new ValidationError();
    }

    const { cursor, limit } = queryResult.data;

    try
    {
        const notifications = await prisma.notifications.findMany({
            where: {
                recipientId: req.id
            },
            take: limit + 1,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: {
                createdAt: "desc"
            }
        });

        let nextCursor: string | null = null;
        if (notifications.length > limit)
        {
            notifications.pop();
            nextCursor = notifications[notifications.length - 1]?.id ?? null;
        }

        return res.status(200).json({
            success: true,
            data: {
                notifications,
                nextCursor
            },
            notifications,
            nextCursor
        });
    } catch (err: any)
    {
        if (err?.code === "P2025")
        {
            throw new ValidationError("Invalid cursor");
        }
        throw err;
    }
}
