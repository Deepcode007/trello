import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errorClass";

export const asyncHandler = (handler: Function) =>
{
    return async (req: Request, res: Response, next?: NextFunction) =>
    {
        try
        {
            await handler(req, res, next);
        }

        catch (e: unknown)
        {
            if (e instanceof AppError)
            {
                return res.status(e.statusCode).json({
                    success: false,
                    error: e.message
                });
            }

            return res.status(500).json({
                success: false,
                error: "Some Server Error"
            });
        }
    }

}
