import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db.ts";
import { match } from "../engine/matching.ts";
import { AppError } from "../utils/error.ts";
import { z } from "zod";
import middleware from "../utils/middleware.ts";

const router = express.Router();

const schema = z.object({
    pair: z.string(),
    side: z.string(),
    type: z.string(),
    price: z.number(),
    quantity: z.number(),
});

router.post(
    "/",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        const userId = res.locals.id;
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return next(new AppError("invalid schema", 401));
        }
        const { pair, side, type, price, quantity } = result.data;

        // side : buy/sell,
        // type : limit/market,
        if (!["buy", "sell"].includes(side)) {
            return next(new AppError("side error", 400));
        }
        if (!["limit", "market"].includes(type)) {
            return next(new AppError("type error", 400));
        }
        if (type == "limit" && !price) {
            return next(new AppError("limit requires price", 400));
        }

        // validate market exists and is active
        const market = await prisma.market.findUnique({
            where: {
                pair,
            },
        });
        if (!market) return next(new AppError("invalid market", 404));
        if (market.status !== "active") {
            return next(new AppError("inactive market", 402));
        }

        // validate quantity >= minorder
        if (quantity < market.minOrder) {
            return next(new AppError(`min order ${market.minOrder}`, 402));
        }

        // lock funds
        const lockAsset = side === "buy" ? market.quoteAsset : market.baseAsset;
        const lockAmount = side === "buy" ? price * quantity : quantity;

        const balance = await prisma.balance.findUnique({
            where: { userId_asset: { userId, asset: lockAsset } },
        });

        if (!balance || balance.available < lockAmount) {
            return res.status(400).json({ error: "insufficient balance" });
        }

        // atomic: move available → reserved
        await prisma.balance.update({
            where: { userId_asset: { userId, asset: lockAsset } },
            data: {
                available: { decrement: lockAmount },
                reserved: { increment: lockAmount },
            },
        });

        // 5. create order in db
        const order = await prisma.order.create({
            data: {
                userId,
                marketId: market.id,
                pair: market.pair,
                side,
                type,
                price: price ?? 0,
                quantity,
                filledQty: 0,
                avgFillPrice: 0,
                status: "open",
            },
        });

        // 6. run matching engine
        const orderWithMeta = {
            ...order,
            pair: market.pair,
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
        };

        const trades = await match(orderWithMeta);

        // 7. persist final order status
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: orderWithMeta.status,
                filledQty: orderWithMeta.filledQty,
                avgFillPrice:
                    trades.length > 0 ? trades[trades.length - 1].price : 0,
            },
        });

        return res.status(201).json({
            order: {
                id: order.id,
                pair,
                side,
                type,
                price,
                quantity,
                status: orderWithMeta.status,
                filledQty: orderWithMeta.filledQty,
            },
            trades: trades.map((t) => ({
                price: t.price,
                qty: t.qty,
                executedAt: t.executedAt,
            })),
        });
    },
);

export default router;
