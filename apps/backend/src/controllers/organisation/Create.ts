import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import { CreateOrgSchema } from "../../models/create_org";
import { Duplicate, ValidationError } from "../../helpers/errorClass";


export async function CreateOrgHandler(req: Request, res: Response)
{
    const result = CreateOrgSchema.safeParse(req.body);
    if (!result.success)
    {
        throw new ValidationError();
    }

    const org = await prisma.membership.findUnique({
        where: {
            id: req.id,
            role: "admin",
            org: {
                name: result.data.name
            }
        }
    })

    if (org != null)
    {
        throw new Duplicate();
    }

    const newOrg = await prisma.orgs.create({
        data: {
            ...result.data,
            members: {
                create: {
                    role: "admin",
                    accepted: true,
                    userId: req.id
                }
            }
        }
    });

    return res.status(201).json({
        success: true,
        data: newOrg
    })
}
