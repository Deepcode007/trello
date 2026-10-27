import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import { Unauthorised } from "../../helpers/errorClass";

export async function markAllAsRead(req: Request, res: Response)
{
    if (!req.id)
    {
        throw new Unauthorised("User unauthorised");
    }

    const updateResult = await prisma.notifications.updateMany({
        where: {
            recipientId: req.id,
            read: false
        },
        data: {
            read: true
        }
    });

    return res.status(200).json({
        success: true,
        data: {
            success: true,
            count: updateResult.count
        },
        count: updateResult.count
    });
}
