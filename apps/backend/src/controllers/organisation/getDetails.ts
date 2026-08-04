import { prisma } from "db/prisma"
import type { Request, Response } from "express"
import zod from "zod"
import { Not_Found, ValidationError } from "../../helpers/errorClass";

export async function getOrgDetails(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!result.success)
    {
        throw new ValidationError();
    }

    const org = await prisma.orgs.findFirst({
        where: {
            id: result.data.orgId,
            OR: [
                {
                    visible: true
                },
                {
                    members: {
                        some: {
                            userId: req.id,
                            accepted: true
                        }
                    }
                }
            ]
        }
    })


    if (!org)
    {
        throw new Not_Found("Org not found/invalid Org Id/user forbidden");
    }

    return res.status(200).json({
        success: true,
        data: org
    })
}
