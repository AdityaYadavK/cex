import express, { Request, Response, NextFunction } from "express";
import { AppError } from "./error.ts";
import jwt from "jsonwebtoken";

const router = express.Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.token;
    if (!token) return next(new AppError("Unauthorized!", 402));
    try {
        const payload = jwt.verify(token, "maxver");
        if (typeof payload == "string") {
            return next(new AppError("invalid payload", 401));
        }
        res.locals.id = payload.id;
        next();
    } catch (e: unknown) {
        if (e instanceof Error) {
            return next(new AppError(e.message, 500));
        }
        return next(new AppError("invalid token", 403));
    }
});

export default router;
