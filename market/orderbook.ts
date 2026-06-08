import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";

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

        // fetch all open orders
        const open = await prisma.order.findMany({
            where: {
                marketId: market.id,
                status: { in: ["OPEN", "partial"] },
            },
            select: {
                side: true,
                price: true,
                quantity: true,
                filledQty: true,
            },
        });

        const bid = new Map<number, number>();
        const ask = new Map<number, number>();

        for (const order of open) {
            const remaining = order.quantity - order.filledQty;
            if (remaining <= 0) continue;

            if (order.side === "buy") {
                bid.set(order.price, (bid.get(order.price) ?? 0) + remaining);
            } else {
                ask.set(order.price, (ask.get(order.price) ?? 0) + remaining);
            }
        }

        const bids = [...bid.entries()]
            .sort((a, b) => b[0] - a[0]) // descending — highest bid first
            .map(([price, qty]) => ({ price, qty }));

        const asks = [...ask.entries()]
            .sort((a, b) => a[0] - b[0]) // ascending — lowest ask first
            .map(([price, qty]) => ({ price, qty }));

        return res.status(200).json({
            pair,
            bids,
            asks,
        });
    },
);

export default router;
