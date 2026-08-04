import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod"
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";


export async function DeleteOrgHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const deleteResult = await prisma.orgs.deleteMany({
        where: {
            id: result.data.orgId,
            members: {
                some: {
                    userId: req.id,
                    role: "admin"
                }
            }
        }
    });

    if (deleteResult.count === 0)
    {
        const org = await prisma.orgs.findUnique({
            where: {
                id: result.data.orgId
            }
        });

        if (!org) throw new Not_Found("Org not found");
        else throw new Forbidden();
    }

    return res.status(200).json({
        success: true
    })
}
