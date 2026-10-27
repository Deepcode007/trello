import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Forbidden, Not_Found, Unauthorised, ValidationError } from "../../helpers/errorClass";

export async function markAsRead(req: Request, res: Response)
{
    if (!req.id)
    {
        throw new Unauthorised("User unauthorised");
    }

    const paramResult = zod.object({
        notificationId: zod.uuid()
    }).safeParse(req.params);

    if (!paramResult.success)
    {
        throw new ValidationError();
    }

    const notification = await prisma.notifications.findUnique({
        where: { id: paramResult.data.notificationId }
    });

    if (!notification)
    {
        throw new Not_Found("Notification not found");
    }

    if (notification.recipientId !== req.id)
    {
        throw new Forbidden("Access Forbidden");
    }

    if (!notification.read)
    {
        await prisma.notifications.update({
            where: { id: paramResult.data.notificationId },
            data: { read: true }
        });
    }

    return res.status(200).json({
        success: true,
        data: { success: true }
    });
}
