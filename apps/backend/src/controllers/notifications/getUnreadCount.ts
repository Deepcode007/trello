import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import { Unauthorised } from "../../helpers/errorClass";

export async function getUnreadCount(req: Request, res: Response)
{
    if (!req.id)
    {
        throw new Unauthorised("User unauthorised");
    }

    const count = await prisma.notifications.count({
        where: {
            recipientId: req.id,
            read: false
        }
    });

    return res.status(200).json({
        success: true,
        data: { count },
        count
    });
}
