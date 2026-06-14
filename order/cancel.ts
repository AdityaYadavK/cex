// orders/cancel.ts
import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db";
import { AppError } from "../utils/error.ts";
import middleware from "../utils/middleware.ts";
import { removeOrderFromBook } from "../engine/matching.ts";
import { broadcastorderbook } from "../ws/server.ts";

const router = express.Router();

router.delete("/:id", middleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = res.locals.id;
        const { id } = req.params;

        if (typeof id !== "string") {
            return next(new AppError("invalid order id", 400));
        }

        // 1. find order — must belong to this user
        const order = await prisma.order.findFirst({
            where: { id, userId },
            include: { market: true },
        });

        if (!order) return res.status(404).json({ error: "order not found" });
        if (!["OPEN", "partial"].includes(order.status)) {
            return res.status(400).json({ error: "order cannot be cancelled" });
        }

        // 2. calculate how much to release
        const remaining = order.quantity - order.filledQty;
        const lockAsset =
            order.side === "buy"
                ? order.market.quoteAsset
                : order.market.baseAsset;
        const lockAmount =
            order.side === "buy" ? order.price * remaining : remaining;

        // 2.5. check current reserved balance to prevent negative values
        const currentBalance = await prisma.balance.findUnique({
            where: { userId_asset: { userId, asset: lockAsset } },
        });

        if (!currentBalance) {
            return res.status(404).json({ error: "balance not found" });
        }

        const actualRelease = Math.min(lockAmount, currentBalance.reserved);

        // 3. release reserved funds + mark cancelled atomically
        await prisma.$transaction([
            prisma.balance.update({
                where: { userId_asset: { userId, asset: lockAsset } },
                data: {
                    reserved: { decrement: actualRelease },
                    available: { increment: actualRelease },
                },
            }),
            prisma.order.update({
                where: { id },
                data: { status: "cancelled" },
            }),
            prisma.ledgerEvent.create({
                data: {
                    userId,
                    asset: lockAsset,
                    eventType: "release",
                    delta: actualRelease,
                    balanceAfter: 0,
                },
            }),
        ]);

        // 4. remove from in-memory orderbook
        removeOrderFromBook(id, order.pair, order.side);

        // 5. broadcast orderbook update
        broadcastorderbook(order.pair, {
            type: "remove",
            order: {
                id: order.id,
                side: order.side,
                price: order.price,
                quantity: order.quantity,
                status: "cancelled",
            },
        });

        return res
            .status(200)
            .json({ message: "order cancelled", orderId: id });
    } catch (err) {
        return res.status(500).json({ error: "internal server error" });
    }
});

export default router;
