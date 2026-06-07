import { prisma } from "../utils/db.ts";
import { AppError } from "../utils/error.ts";

// in-memory engine order shape
type Order = {
    id: string;
    pair: string; // e.g. "BTC/USDT"
    side: "buy" | "sell";
    type: "market" | "limit";
    price: number;
    quantity: number;
    filledQty: number;
    status: "open" | "partial" | "filled" | "cancelled";
    userId: string;
    baseAsset: string; // e.g. "BTC"
    quoteAsset: string; // e.g. "USDT"
};

type Trade = {
    buyOrderId: string;
    sellOrderId: string;
    pair: string;
    fillQty: number;
    fillPrice: number;
};

const orderbook: Record<string, { bids: Order[]; asks: Order[] }> = {};

// get or create a book for a pair
function getBook(pair: string) {
    if (!orderbook[pair]) {
        orderbook[pair] = { bids: [], asks: [] };
    }
    return orderbook[pair];
}

// core matching function
export async function match(incoming: Order): Promise<Trade[]> {
    const book = getBook(incoming.pair);
    const trades: Trade[] = [];

    if (incoming.side === "buy") {
        // BUY logic
        // best asks for buyer: lowest price first
        book.asks.sort((a, b) => a.price - b.price);

        let remaining = incoming.quantity;

        for (let i = 0; i < book.asks.length && remaining > 0; i++) {
            const ask = book.asks[i];
            if (!ask) break;

            // LIMIT BUY: only match if ask.price <= buy.price
            if (incoming.type === "limit" && ask.price > incoming.price) {
                break;
            }

            const leftOnAsk = ask.quantity - ask.filledQty;
            const fillQty = Math.min(remaining, leftOnAsk);
            const fillPrice = ask.price; // maker price wins

            const trade = await executeFill(incoming, ask, fillQty, fillPrice);
            trades.push(trade);

            remaining -= fillQty;
            incoming.filledQty += fillQty;
            ask.filledQty += fillQty;

            // update ask in memory
            if (ask.filledQty >= ask.quantity) {
                book.asks.splice(i, 1);
                i--;
            } else {
                ask.status = "partial";
            }
        }

        // update incoming order status after all matches
        incoming.filledQty = incoming.quantity - remaining;
        if (remaining === 0) {
            incoming.status = "filled";
        } else if (incoming.filledQty > 0) {
            incoming.status = "partial";
            if (incoming.type === "limit") {
                book.bids.push(incoming);
            }
        } else {
            incoming.status = "open";
            if (incoming.type === "limit") {
                book.bids.push(incoming);
            }
        }
    } else {
        // SELL logic
        // best bids for seller: highest price first
        book.bids.sort((a, b) => b.price - a.price);

        let remaining = incoming.quantity;

        for (let i = 0; i < book.bids.length && remaining > 0; i++) {
            const bid = book.bids[i];
            if (!bid) break;

            // LIMIT SELL: only match if bid.price >= sell.price
            if (incoming.type === "limit" && bid.price < incoming.price) {
                break;
            }

            const leftOnBid = bid.quantity - bid.filledQty;
            const fillQty = Math.min(remaining, leftOnBid);
            const fillPrice = bid.price;

            const trade = await executeFill(bid, incoming, fillQty, fillPrice);
            trades.push(trade);

            remaining -= fillQty;
            bid.filledQty += fillQty;

            if (bid.filledQty >= bid.quantity) {
                book.bids.splice(i, 1);
                i--;
            } else {
                bid.status = "partial";
            }
        }

        incoming.filledQty = incoming.quantity - remaining;
        if (remaining === 0) {
            incoming.status = "filled";
        } else if (incoming.filledQty > 0) {
            incoming.status = "partial";
            if (incoming.type === "limit") {
                book.asks.push(incoming);
            }
        } else {
            incoming.status = "open";
            if (incoming.type === "limit") {
                book.asks.push(incoming);
            }
        }
    }

    return trades;
}

// settlement: one partial fill (trade)
async function executeFill(
    buyorder: Order,
    sellorder: Order,
    fillQty: number,
    fillPrice: number,
): Promise<Trade> {
    const cost = fillQty * fillPrice;

    return await prisma.$transaction(async (tx) => {
        // 1. create trade record
        const tradeRecord = await tx.trade.create({
            data: {
                buyOrderId: buyorder.id,
                sellOrderId: sellorder.id,
                pair: buyorder.pair,
                price: fillPrice,
                qty: fillQty,
                buyerFee: 0,
                sellerFee: 0,
            },
        });

        // 2. update both orders in db
        await tx.order.update({
            where: { id: buyorder.id },
            data: {
                filledQty: { increment: fillQty },
                status: buyorder.status,
            },
        });

        await tx.order.update({
            where: { id: sellorder.id },
            data: {
                filledQty: { increment: fillQty },
                status: sellorder.status,
            },
        });

        // 3. balances: buyer (quote -> base)
        await tx.balance.update({
            where: {
                userId_asset: {
                    userId: buyorder.userId,
                    asset: buyorder.quoteAsset,
                },
            },
            data: {
                reserved: { decrement: cost },
            },
        });

        await tx.balance.upsert({
            where: {
                userId_asset: {
                    userId: buyorder.userId,
                    asset: buyorder.baseAsset,
                },
            },
            update: {
                available: { increment: fillQty },
            },
            create: {
                userId: buyorder.userId,
                asset: buyorder.baseAsset,
                available: fillQty,
                reserved: 0,
            },
        });

        // 4. balances: seller (base -> quote)
        await tx.balance.update({
            where: {
                userId_asset: {
                    userId: sellorder.userId,
                    asset: sellorder.baseAsset,
                },
            },
            data: {
                reserved: { decrement: fillQty },
            },
        });

        await tx.balance.upsert({
            where: {
                userId_asset: {
                    userId: sellorder.userId,
                    asset: sellorder.quoteAsset,
                },
            },
            update: {
                available: { increment: cost },
            },
            create: {
                userId: sellorder.userId,
                asset: sellorder.quoteAsset,
                available: cost,
                reserved: 0,
            },
        });

        // 5. ledger events (simplified, balanceAfter = 0 for now)
        await tx.ledgerEvent.createMany({
            data: [
                {
                    userId: buyorder.userId,
                    tradeId: tradeRecord.id,
                    asset: buyorder.quoteAsset,
                    eventType: "trade_debit",
                    delta: -cost,
                    balanceAfter: 0,
                },
                {
                    userId: buyorder.userId,
                    tradeId: tradeRecord.id,
                    asset: buyorder.baseAsset,
                    eventType: "trade_credit",
                    delta: fillQty,
                    balanceAfter: 0,
                },
                {
                    userId: sellorder.userId,
                    tradeId: tradeRecord.id,
                    asset: sellorder.baseAsset,
                    eventType: "trade_debit",
                    delta: -fillQty,
                    balanceAfter: 0,
                },
                {
                    userId: sellorder.userId,
                    tradeId: tradeRecord.id,
                    asset: sellorder.quoteAsset,
                    eventType: "trade_credit",
                    delta: cost,
                    balanceAfter: 0,
                },
            ],
        });

        const trade: Trade = {
            buyOrderId: buyorder.id,
            sellOrderId: sellorder.id,
            pair: buyorder.pair,
            fillQty,
            fillPrice,
        };

        return trade;
    });
}

// load from db into memory on startup
export default async function loadOrderBook() {
    const openOrders = await prisma.order.findMany({
        where: { status: { in: ["open", "partial"] } },
        include: {
            market: true,
        },
    });

    for (const order of openOrders) {
        const book = getBook(order.market.pair);

        const entry: Order = {
            id: order.id,
            pair: order.market.pair,
            side: order.side as "buy" | "sell",
            type: order.type as "market" | "limit",
            price: order.price,
            quantity: order.quantity,
            filledQty: order.filledQty,
            status: order.status as any,
            userId: order.userId,
            baseAsset: order.market.baseAsset,
            quoteAsset: order.market.quoteAsset,
        };

        if (entry.side === "buy") {
            book.bids.push(entry);
        } else {
            book.asks.push(entry);
        }
    }

    console.log(`loaded ${openOrders.length} open orders into memory`);
}
