import { app } from "../..";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { token } from "../middlewares/token";
import { prisma } from "db/prisma";
import { SigninSchema } from "../models/signin";


export async function loginHandler(req: Request, res: Response)
{
	try {
		const result = SigninSchema.safeParse(req.body);
		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: "Invalid inputs"
			});
		}

		let user = await prisma.user.findUnique({
			where: {
				email: result.data.email
			}
		})

		if (!user) {
			return res.status(400).json({
				success: false,
				error: "User not found"
			})
		}

		if (!await bcrypt.compare(result.data.password, user.password)) {
			return res.status(401).json({
				success: false,
				error: "Invalid Password"
			})
		}

		return res.status(201).json({
			success: true,
			data: token(user.email, user.id)
		})

	}
	catch (e) {
		return res.status(500).json({
			success: false,
			error: "Internal Server error"
		})
	}
}
