import type { Request, Response } from "express";
import { prisma } from "db/prisma";


export async function getCurrentOrgs(req: Request, res: Response)
{
    let orgs = await prisma.membership.findMany({
        where: {
            id: req.id
        }
    })

    return res.status(200).json({
        success: true,
        data: orgs
    })
}
