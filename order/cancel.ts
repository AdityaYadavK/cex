// orders/cancel.ts
import { Request, Response } from "express";
import { prisma } from "../utils/db";

export async function cancelOrder(req: Request, res: Response) {
    try {
        const userId = res.locals.id;
        const { id } = req.params;

        if (typeof id !== "string") {
            return;
        }

        // 1. find order — must belong to this user
        const order = await prisma.order.findFirst({
            where: { id, userId },
            include: { market: true },
        });

        if (!order) return res.status(404).json({ error: "order not found" });
        if (!["open", "partial"].includes(order.status)) {
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

        // 3. release reserved funds + mark cancelled atomically
        await prisma.$transaction([
            prisma.balance.update({
                where: { userId_asset: { userId, asset: lockAsset } },
                data: {
                    reserved: { decrement: lockAmount },
                    available: { increment: lockAmount },
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
                    delta: lockAmount,
                    balanceAfter: 0,
                },
            }),
        ]);

        return res
            .status(200)
            .json({ message: "order cancelled", orderId: id });
    } catch (err) {
        return res.status(500).json({ error: "internal server error" });
    }
}
