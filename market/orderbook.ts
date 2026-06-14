import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";
import { getAggregatedOrderbook } from "../engine/matching.ts";

const router = express.Router();

router.get(
    "/:pair",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        const p = req.params.pair;
        if (typeof p !== "string") {
            return next(new AppError("invalid pair", 403));
        }
        const pair = p.replace("-", "/");
        console.log(pair);
        const market = await prisma.market.findUnique({
            where: {
                pair,
            },
        });

        if (!market) return next(new AppError("invalid market", 404));

        // Use the in-memory aggregated orderbook for better performance
        const aggregatedBook = getAggregatedOrderbook(pair);

        return res.status(200).json({
            pair,
            bids: aggregatedBook.bids,
            asks: aggregatedBook.asks,
        });
    },
);

export default router;
