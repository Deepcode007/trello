import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
import zod from "zod";
import { UpdateOrgSchema } from "../../models/update_org";


export async function UpdateOrgHandler(req: Request, res: Response)
{
    const result = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    const details = UpdateOrgSchema.safeParse(req.body);

    if (!result.success || !details.success)
    {
        throw new ValidationError();
    }

    const existingOrg = await prisma.orgs.findUnique({
        where: { id: result.data.orgId },
        select: {
            members: {
                where: {
                    userId: req.id,
                    role: "admin"
                }
            }
        }
    });

    if (!existingOrg)
    {
        throw new Not_Found("Organization not found");
    }

    if (existingOrg.members.length === 0)
    {
        throw new Forbidden("You do not have permission to modify this organization");
    }

    const org = await prisma.orgs.update({
        where: { id: result.data.orgId },
        data: details.data
    });

    return res.status(200).json({
        success: true,
        data: org
    })
}
