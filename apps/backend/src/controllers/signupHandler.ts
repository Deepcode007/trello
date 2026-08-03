import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "db/prisma";
import { SignupSchema } from "../models/signup";


export async function signupHandler(req: Request, res: Response)
{
	try {
		const result = SignupSchema.safeParse(req.body);
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

		if (user) {
			return res.status(400).json({
				success: false,
				error: "Email exists"
			})
		}

		result.data.password = await bcrypt.hash(result.data.password, 10);
		user = await prisma.user.create({
			data: result.data
		});

		let { password, ...data } = user;
		return res.status(201).json({
			success: true,
			data: data
		})

	}
	catch (e) {
		return res.status(500).json({
			success: false,
			error: "Internal Server error"
		})
	}
}