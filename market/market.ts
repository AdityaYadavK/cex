import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";

const router = express.Router();

router.get("/", middleware, async (req: Request, res: Response) => {
    const market = await prisma.market.findMany({
        where: {
            status: "active",
        },
        select: {
            pair: true,
            baseAsset: true,
            quoteAsset: true,
            minOrder: true,
            tickSize: true,
            makerFee: true,
            takerFee: true,
            status: true,
        },
    });
    return res.status(200).json({ market });
});

export default router;
