import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db.ts";
import { AppError } from "../utils/error.ts";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

const schema = z.object({
    email: z.email(),
    password: z.string().min(6),
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return next(new AppError("schema error", 400));
    }
    const { email, password } = result.data;
    const exists = await prisma.user.findUnique({
        where: {
            email,
        },
    });
    if (exists) return next(new AppError("email exists", 409));
    const hash = await bcrypt.hash(password, 11);
    const u = await prisma.user.create({
        data: {
            email,
            password: hash,
        },
    });
    if (!u) return next(new AppError("internal db error", 500));
    const jwtSecret = process.env.JWT_SECRET || "maxver";
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "30d";
    // @ts-ignore - TypeScript issue with jsonwebtoken types
    const token = jwt.sign({ id: u.id }, jwtSecret, { expiresIn: jwtExpiresIn });
    const isSecure = process.env.NODE_ENV === "production" ? (process.env.COOKIE_SECURE === "true") : false;
    res.cookie("token", token, {
        httpOnly: process.env.COOKIE_HTTP_ONLY !== "false",
        secure: isSecure,
        sameSite: (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax",
        maxAge: 1000 * 60 * 60 * 24 * 30,
        path: "/",
    })
        .status(200)
        .json({ msg: "signed up!" });
});

export default router;
