import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(new AppError("schema parse", 400));
    const { email, password } = result.data;
    const u = await prisma.user.findUnique({
        where: {
            email,
        },
    });
    if (!u) return next(new AppError("email unsigned", 404));
    const ver = await bcrypt.compare(password, u.password);
    if (!ver) return next(new AppError("incorrect password", 401));
    const token = jwt.sign({ id: u.id }, "maxver", { expiresIn: "30d" });
    res.cookie("token", token, {
        httpOnly: true,
        secure: false,
        // signed: true,
        maxAge: 1000 * 60 * 24 * 30,
        path: "/",
    })
        .status(200)
        .json({ msg: "logged in!" });
});

export default router;
