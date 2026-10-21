import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { token } from "../middlewares/token";
import { prisma } from "db/prisma";
import { SigninSchema } from "../models/signin";


const DUMMY_HASH = "$2b$10$Wf1iodB9dPufoIBYBXlkDutPz69kRFHSBnmcFAgQregd56rzG8V.S";

export async function loginHandler(req: Request, res: Response)
{
    try
    {
        const result = SigninSchema.safeParse(req.body);
        if (!result.success)
        {
            return res.status(400).json({
                success: false,
                error: "Invalid inputs"
            });
        }

        let user = await prisma.user.findUnique({
            where: {
                email: result.data.email
            }
        });

        const passwordHash = user ? user.password : DUMMY_HASH;
        const isPasswordValid = await bcrypt.compare(result.data.password, passwordHash);

        if (!user || !isPasswordValid)
        {
            return res.status(401).json({
                success: false,
                error: "Invalid email or password"
            });
        }

        const displayName = (user.name && !user.name.includes("@"))
            ? user.name.trim()
            : (user.username && !user.username.includes("@"))
                ? user.username.trim()
                : (user.email ? user.email.split("@")[0] : "User");

        return res.status(200).json({
            success: true,
            data: token(user.email, user.id, displayName, user.username)
        })

    }
    catch (e)
    {
        return res.status(500).json({
            success: false,
            error: "Internal Server error"
        })
    }
}
