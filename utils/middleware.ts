import express, { Request, Response, NextFunction } from "express";
import { AppError } from "./error.ts";
import jwt from "jsonwebtoken";
import { prisma } from "./db.ts";

export default async function middleware(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const token = req.cookies.token;
    if (!token) return next(new AppError("Unauthorized!", 401));
    try {
        const payload = jwt.verify(token, "maxver");
        if (typeof payload == "string") {
            return next(new AppError("invalid payload", 401));
        }
        const user = await prisma.user.findUnique({
            where: {
                id: payload.id,
            },
        });

        if (!user) {
            return next(new AppError("invalid user", 404));
        }
        res.locals.id = payload.id;
        next();
    } catch (e: unknown) {
        if (e instanceof Error) {
            return next(new AppError(e.message, 401));
        }
        return next(new AppError("invalid token", 401));
    }
}
