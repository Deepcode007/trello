import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";

export async function createBoard(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const result2 = zod.object({
        title: zod.string()
    }).safeParse(req.body);

    if (!result.success || !result2.success)
    {
        throw new ValidationError();
    }

    const user = await prisma.orgs.findUnique({
        where: {
            id: result.data.orgId
        },
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
    })

    
    if (!user) throw new Not_Found("Org not found/invalid Org Id");
    if (user.members.length == 0) throw new Forbidden("Employee/Admin access only");

    const board = await prisma.boards.create({
        data: {
            title: result2.data.title,
            orgId: result.data.orgId
        }
    })



    return res.status(201).json({
        success: true,
        data: board
    })
}
