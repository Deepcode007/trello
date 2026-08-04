import type { Request, Response } from "express";
import { prisma } from "db/prisma";


export async function profileHandler(req: Request, res: Response)
{
    try {

        let user = await prisma.user.findUnique({
            where: {
                id: req.id
            },
            include: {
                memberships: {
                    select: {
                        user: {
                            select: {
                                email: true,
                                username: true
                            }
                        },
                        role: true,
                        org: {
                            select: {
                                name: true,
                                description: true
                            }
                        }
                    }
                }
            }
        });

		if (!user) {
            return res.status(404).json({
                success: false,
                error: "User not found"
            })
		}

		
		return res.status(200).json({
			success: true,
			data: user
		})

	}
	catch (e) {
		return res.status(500).json({
			success: false,
			error: "Internal Server error"
		})
	}
}