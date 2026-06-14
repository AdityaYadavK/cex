import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db.ts";
import { match } from "../engine/matching.ts";
import { AppError } from "../utils/error.ts";
import { z } from "zod";
import middleware from "../utils/middleware.ts";

const router = express.Router();

const schema = z.object({
    pair: z.string().regex(/^[A-Z]+\/[A-Z]+$/, "Invalid pair format. Use format like 'BTC/USDT'"),
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
        let lockAmount: number;

        if (type === "market" && side === "buy") {
            // For market buy orders, estimate the cost using a conservative multiplier
            // Get the best ask price from the orderbook to estimate cost
            const book = await prisma.order.findMany({
                where: {
                    marketId: market.id,
                    side: "sell",
                    status: { in: ["OPEN", "partial"] },
                },
                orderBy: { price: "asc" },
                take: 1,
            });

            let estimatedPrice = price || 0; // Use provided price as fallback
            if (book.length > 0 && book[0] && book[0].price > 0) {
                estimatedPrice = book[0].price;
            } else {
                // Fallback: use a reasonable default if no orders in book
                estimatedPrice = 5000000; // $50,000 as default for BTC
            }

            // Use 2x the best ask price as a conservative estimate to account for slippage
            lockAmount = estimatedPrice * quantity * 2;

            // Ensure we don't lock more than available balance
            const bal = await prisma.balance.findUnique({
                where: { userId_asset: { userId, asset: lockAsset } },
            });
            if (!bal || bal.available <= 0)
                return next(new AppError("insufficient balance", 400));

            // Cap at available balance
            lockAmount = Math.min(lockAmount, bal.available);
        } else {
            lockAmount = side === "buy" ? price! * quantity : quantity;
        }

        if (lockAmount == null) {
            return next(new AppError("insufficient balance", 402));
        }

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
                status: "OPEN",
            },
        });

        const porder = {
            id: order.id,
            pair: order.pair,
            side: order.side,
            type: order.type,
            price: order.price,
            quantity: order.quantity,
            filledQty: order.filledQty,
            status: order.status,
            userId: order.userId,
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
        };

        const trades = await match(porder);

        const totalQty = trades.reduce((sum, t) => sum + t.fillQty, 0);
        const totalNotional = trades.reduce(
            (sum, t) => sum + t.fillPrice * t.fillQty,
            0,
        );

        // refund the remaining balace after matching
        if (type === "market" && side === "buy") {
            const usedQuote = trades.reduce(
                (sum, t) => sum + t.fillPrice * t.fillQty,
                0,
            );
            const refund = lockAmount - usedQuote;
            if (refund > 0) {
                // Check current reserved balance to prevent negative values
                const currentBalance = await prisma.balance.findUnique({
                    where: { userId_asset: { userId, asset: lockAsset } },
                });

                if (currentBalance) {
                    const actualRefund = Math.min(refund, currentBalance.reserved);
                    if (actualRefund > 0) {
                        await prisma.balance.update({
                            where: { userId_asset: { userId, asset: lockAsset } },
                            data: {
                                reserved: { decrement: actualRefund },
                                available: { increment: actualRefund },
                            },
                        });
                    }
                }
            }
        }

        const avgFillPrice = totalQty > 0 ? totalNotional / totalQty : 0;

        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: porder.status,
                filledQty: porder.filledQty,
                avgFillPrice: avgFillPrice,
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
                status: porder.status,
                filledQty: porder.filledQty,
            },
            trades: trades.map((t) => ({
                price: t.fillPrice,
                qty: t.fillQty,
                executedAt: t.executedAt,
            })),
        });
    },
);

export default router;
