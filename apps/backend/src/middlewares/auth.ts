import jwt, { type JwtPayload, type Secret } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { env } from "../..";

const secret = env.jwt_key as Secret;

export function auth(req: Request, res: Response, next: NextFunction) {
	try {
		const token = req.headers?.authorization?.split(' ')[1];
		if (!token) {
			return res.status(401).json({
				success: false,
				error: "User unauthorised"
			});
		}
		const data = jwt.verify(token, secret) as JwtPayload;
		req.id = data.id;
		req.email = data.email;
		next();
	} catch (e) {
		return res.status(401).json({
			success: false,
			error: "User unauthorised"
		});
	}
}