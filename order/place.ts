import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db.ts";
import { match } from "../engine/matching.ts";
import { AppError } from "../utils/error.ts";
import { z } from "zod";
import middleware from "../utils/middleware.ts";

const router = express.Router();

const schema = z.object({
    pair: z.string(),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["limit", "market"]),
    price: z.number().positive().optional(),
    quantity: z.number().positive(),
});

router.post(
    "/",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        const userId = res.locals.id as string;

        const result = schema.safeParse(req.body);
        if (!result.success) {
            return next(new AppError("invalid schema", 400));
        }

        const { pair, side, type, price, quantity } = result.data;

        // zod already validates side and type — no need for manual checks
        if (type === "limit" && !price) {
            return next(new AppError("limit order requires price", 400));
        }

        const market = await prisma.market.findUnique({ where: { pair } });
        if (!market) return next(new AppError("market not found", 404));
        if (market.status !== "active")
            return next(new AppError("market halted", 400));
        if (quantity < market.minOrder)
            return next(
                new AppError(`min order size is ${market.minOrder}`, 400),
            );

        // lock funds
        const lockAsset = side === "buy" ? market.quoteAsset : market.baseAsset;
        // market buy: price is undefined — lock available balance, caller must pass quantity in quote units
        const lockAmount = side === "buy" ? (price ?? 0) * quantity : quantity;

        if (lockAmount <= 0) {
            return next(new AppError("invalid lock amount", 400));
        }

        const balance = await prisma.balance.findUnique({
            where: { userId_asset: { userId, asset: lockAsset } },
        });

        if (!balance || balance.available < lockAmount) {
            return next(new AppError("insufficient balance", 400));
        }

        await prisma.balance.update({
            where: { userId_asset: { userId, asset: lockAsset } },
            data: {
                available: { decrement: lockAmount },
                reserved: { increment: lockAmount },
            },
        });

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

        const orderWithMeta = {
            ...order,
            pair: market.pair,
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
        };

        const trades = await match(orderWithMeta);

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
