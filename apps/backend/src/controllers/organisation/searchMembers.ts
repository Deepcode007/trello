import type { Request, Response } from "express";
import { prisma } from "db/prisma";
import zod from "zod";
import { Forbidden, ValidationError } from "../../helpers/errorClass";

export async function searchMembersHandler(req: Request, res: Response)
{
    const paramResult = zod.object({
        orgId: zod.uuid()
    }).safeParse(req.params);

    if (!paramResult.success)
    {
        throw new ValidationError();
    }

    const queryResult = zod.object({
        q: zod.string().optional().default(""),
        limit: zod.coerce.number().int().min(1).max(20).optional().default(10)
    }).safeParse(req.query);

    if (!queryResult.success)
    {
        throw new ValidationError();
    }

    const { orgId } = paramResult.data;
    const { q, limit } = queryResult.data;

    // Verify requester has accepted membership in this org
    const requesterMembership = await prisma.membership.findUnique({
        where: {
            userId_orgId: {
                userId: req.id,
                orgId
            },
            accepted: true
        }
    });

    if (!requesterMembership)
    {
        throw new Forbidden("Member access only");
    }

    const trimmedQuery = q.trim();
    const whereClause: any = {
        orgId,
        accepted: true
    };

    if (trimmedQuery.length > 0)
    {
        whereClause.user = {
            OR: [
                { username: { contains: trimmedQuery, mode: "insensitive" } },
                { name: { contains: trimmedQuery, mode: "insensitive" } }
            ]
        };
    }

    const memberships = await prisma.membership.findMany({
        where: whereClause,
        take: limit,
        select: {
            user: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    avatarUrl: true
                }
            }
        }
    });

    const members = memberships
        .filter(m => m.user)
        .map(m => ({
            id: m.user.id,
            name: m.user.name,
            username: m.user.username,
            avatarUrl: m.user.avatarUrl
        }));

    return res.status(200).json({
        success: true,
        data: members,
        members
    });
}
