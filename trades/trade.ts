import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db.ts";
import { AppError } from "../utils/error.ts";
import middleware from "../utils/middleware.ts";

const router = express.Router();

// this is a comment
router.get(
    "/:id",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = res.locals.id;
            const { id } = req.params;

            if (typeof id !== "string") {
                return next(new AppError("invalid id", 400));
            }

            const trade = await prisma.trade.findUnique({
                where: { id },
                include: {
                    buyOrder: {
                        select: { userId: true, price: true, quantity: true },
                    },
                    sellOrder: {
                        select: { userId: true, price: true, quantity: true },
                    },
                },
            });

            if (!trade) {
                return res.status(404).json({ error: "trade not found" });
            }

            // verify user participated — never expose other users' trades
            const userSide =
                trade.buyOrder.userId === userId
                    ? "buy"
                    : trade.sellOrder.userId === userId
                      ? "sell"
                      : null;

            if (!userSide) {
                return res.status(403).json({ error: "forbidden" });
            }

            return res.status(200).json({
                id: trade.id,
                pair: trade.pair,
                price: trade.price,
                qty: trade.qty,
                side: userSide,
                fee: userSide === "buy" ? trade.buyerFee : trade.sellerFee,
                executedAt: trade.executedAt,
            });
        } catch (err) {
            return res.status(500).json({ error: "internal server error" });
        }
    },
);

export default router;
