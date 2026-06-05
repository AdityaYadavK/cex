import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";
import { z } from "zod";

const router = express.Router();

const schema = z.object({
    asset: z.string(),
    amount: z.number(),
});

router.post(
    "/",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        const id = res.locals.id;
        const result = schema.safeParse(req.body);
        if (!result.success) return next(new AppError("invalid schma", 403));

        const { asset, amount } = result.data;

        // upsert : create if first depost otherwise update
        const balance = await prisma.balance.upsert({
            where: {
                userId_asset: {
                    asset,
                    userId: id,
                },
            },
            update: {
                available: { increment: amount },
            },
            create: {
                asset,
                available: amount,
                reserved: 0,
                userId: id,
            },
        });

        // transaction record
        const txn = await prisma.transaction.create({
            data: {
                type: "Deposit",
                asset: asset,
                amount: amount,
                status: "Complete",
                direction: "in",
                userId: id,
            },
        });

        // ledger event
        const led = await prisma.ledgerEvent.create({
            data: {
                asset: asset,
                eventType: "deposit",
                delta: amount,
                balanceAfter: balance.available,
                userId: id,
            },
        });

        return res.status(200).json({
            msg: "succesfull deposit",
            asset,
            deposited: amount,
            balance: {
                available: balance.available,
                reserved: balance.reserved,
            },
            transactionId: txn.id,
        });
    },
);

export default router;
