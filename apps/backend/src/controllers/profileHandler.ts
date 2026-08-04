import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import { Not_Found } from "../helpers/errorClass";


export async function profileHandler(req: Request, res: Response)
{
    let user = await prisma.user.findUnique({
        where: {
            id: req.id
        },
        omit: {
            password: true,
            id: true
        },
        include: {
            memberships: {
                select: {
                    role: true,
                    org: {
                        select: {
                            name: true,
                        }
                    }
                }
            }
        }
    });

    if (!user)
    {
        throw new Not_Found();
    }


    return res.status(200).json({
        success: true,
        data: user
    })

}
