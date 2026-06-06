import express, { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db";
import { AppError } from "../utils/error.ts";
import middleware from "../utils/middleware.ts";

const router = express.Router();

function getQueryString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

router.get("/", middleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = res.locals.id;
        const p = getQueryString(req.query.pair);
        const status = getQueryString(req.query.status);
        
        if (p) {
            const pair = p.replace("-", "/");
            const orders = await prisma.order.findMany({
                where: {
                    userId,
                    pair,
                    ...(status ? { status } : {}),
                },
                orderBy: { createdAt: "desc" },
                take: 50,
            });
            return res.status(200).json({ success: true, orders });
        }

        const orders = await prisma.order.findMany({
            where: {
                userId,
                ...(status ? { status } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 50,
        });

        return res.status(200).json({ success: true, orders });
    } catch (err) {
        return res
            .status(500)
            .json({ success: false, error: "internal server error" });
    }
});

export default router;
