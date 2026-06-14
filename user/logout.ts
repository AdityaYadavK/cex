import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import middleware from "../utils/middleware.ts";

const router = express.Router();

router.post("/", middleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Clear the token cookie
        res.clearCookie("token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production" ? (process.env.COOKIE_SECURE === "true") : false,
            sameSite: (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax",
            path: "/",
        });

        return res.status(200).json({ msg: "logged out successfully" });
    } catch (err) {
        return next(new AppError("logout failed", 500));
    }
});

export default router;