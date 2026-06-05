import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";

const router = express.Router();

router.get("/", middleware, async (req: Request, res: Response) => {
    const id = res.locals.id;
    const balance = await prisma.balance.findMany({
        where: {
            userId: id,
        },
        select: {
            asset: true,
            available: true,
            reserved: true,
        },
    });
    return res.status(200).json({ balance });
});

export default router;
