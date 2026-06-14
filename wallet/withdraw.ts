import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";
import { z } from "zod";

const router = express.Router();

const schema = z.object({
    asset: z.string().min(1),
    amount: z.number().positive(),
    address: z.string().min(1), // For blockchain withdrawals
});

router.post(
    "/",
    middleware,
    async (req: Request, res: Response, next: NextFunction) => {
        const userId = res.locals.id;
        const result = schema.safeParse(req.body);
        if (!result.success) return next(new AppError("invalid schema", 400));

        const { asset, amount, address } = result.data;

        // Check if user has sufficient balance
        const balance = await prisma.balance.findUnique({
            where: {
                userId_asset: {
                    userId,
                    asset,
                },
            },
        });

        if (!balance) {
            return next(new AppError("balance not found", 404));
        }

        if (balance.available < amount) {
            return next(new AppError("insufficient balance", 400));
        }

        // Process withdrawal atomically
        try {
            const result = await prisma.$transaction(async (tx) => {
                // Deduct from available balance
                const updatedBalance = await tx.balance.update({
                    where: {
                        userId_asset: {
                            userId,
                            asset,
                        },
                    },
                    data: {
                        available: { decrement: amount },
                    },
                });

                // Create transaction record
                const transaction = await tx.transaction.create({
                    data: {
                        userId,
                        type: "Withdraw",
                        asset,
                        amount,
                        status: "Pending",
                        direction: "out",
                    },
                });

                // Create ledger event
                const ledgerEvent = await tx.ledgerEvent.create({
                    data: {
                        userId,
                        asset,
                        eventType: "withdraw",
                        delta: -amount,
                        balanceAfter: updatedBalance.available - amount,
                    },
                });

                return {
                    transaction,
                    ledgerEvent,
                    balance: updatedBalance,
                };
            });

            return res.status(200).json({
                msg: "withdrawal initiated",
                asset,
                amount,
                address,
                transactionId: result.transaction.id,
                status: result.transaction.status,
            });
        } catch (error) {
            return next(new AppError("withdrawal failed", 500));
        }
    },
);

export default router;