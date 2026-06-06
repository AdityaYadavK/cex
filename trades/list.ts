import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db.ts";
import { AppError } from "../utils/error.ts";
import middleware from "../utils/middleware.ts";

const router = express.Router();

router.get(
    "/",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        const userId = res.locals.id;
        const { pair, page = "1", limit = "20" } = req.query;
        const pagen = parseInt(page as string);
        const limitn = parseInt(limit as string);
        const skip = (pagen - 1) * limitn;

        // find all trade where user was buyer or seller
        const trades = await prisma.trade.findMany({
            where: {
                OR: [{ buyOrder: { userId } }, { sellOrder: { userId } }],
                ...(pair ? { pair: pair as string } : {}),
            },
            include: {
                buyOrder: { select: { userId: true, side: true } },
                sellOrder: { select: { userId: true, side: true } },
            },
            orderBy: {
                executedAt: "desc",
            },
            take: limitn,
            skip,
        });

        const formatted = trades.map((t) => ({
            id: t.id,
            pair: t.pair,
            price: t.price,
            qty: t.qty,
            side: t.buyOrder.userId === userId ? "buy" : "sell",
            fee: t.buyOrder.userId === userId ? t.buyerFee : t.sellerFee,
            executedAt: t.executedAt,
        }));

        return res.status(200).json({
            trades: formatted,
            page: pagen,
            limit: limitn,
        });
    },
);

export default router;
