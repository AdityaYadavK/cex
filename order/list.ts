// orders/list.ts
import { Request, Response } from "express";
import { prisma } from "../utils/db";

export async function listOrders(req: Request, res: Response) {
  try {
    const userId = res.locals.id;
    const { pair, status } = req.query;

    const orders = await prisma.order.findMany({
      where: {
        userId,
        ...(pair   ? { pair:   pair as string   } : {}),
        ...(status ? { status: status as string } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.status(200).json({ orders });
  } catch (err) {
    return res.status(500).json({ error: "internal server error" });
  }
}