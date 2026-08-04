import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "db/prisma";
import { SignupSchema } from "../models/signup";
import { Duplicate, ValidationError } from "../helpers/errorClass";


export async function signupHandler(req: Request, res: Response)
{
    const result = SignupSchema.safeParse(req.body);
    if (!result.success)
    {
        throw new ValidationError();
    }

    let user = await prisma.user.findUnique({
        where: {
            email: result.data.email
        }
    })

    if (user)
    {
        throw new Duplicate();
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
