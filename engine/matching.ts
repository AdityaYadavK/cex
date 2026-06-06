import { prisma } from "../utils/db.ts";

// in-memory order book
// structure: { [pair]: { bids: Order[], asks: Order[] } }
const orderBooks: Record<
    string,
    {
        bids: any[];
        asks: any[];
    }
> = {};

function getBook(pair: string) {
    if (!orderBooks[pair]) {
        orderBooks[pair] = { bids: [], asks: [] };
    }
    return orderBooks[pair];
}

export async function match(incomingOrder: any) {
    const book = getBook(incomingOrder.pair);
    const trades: any[] = [];

    if (incomingOrder.side === "buy") {
        // sort asks ascending — lowest ask first (best for buyer)
        book.asks.sort((a, b) => a.price - b.price);

        let remaining = incomingOrder.quantity;

        for (let i = 0; i < book.asks.length && remaining > 0; i++) {
            const ask = book.asks[i];

            // limit order: only match if ask price <= buy price
            if (
                incomingOrder.type === "limit" &&
                ask.price > incomingOrder.price
            )
                break;

            const fillQty = Math.min(remaining, ask.quantity - ask.filledQty);
            const fillPrice = ask.price; // maker's price always wins

            // execute the fill
            const trade = await executeFill(
                incomingOrder,
                ask,
                fillQty,
                fillPrice,
            );
            trades.push(trade);

            remaining -= fillQty;
            incomingOrder.filledQty += fillQty;

            // update ask in memory
            ask.filledQty += fillQty;
            if (ask.filledQty >= ask.quantity) {
                book.asks.splice(i, 1); // fully filled — remove from book
                i--;
            } else {
                ask.status = "partial";
            }
        }

        // update incoming order status
        incomingOrder.filledQty = incomingOrder.quantity - remaining;
        if (remaining === 0) {
            incomingOrder.status = "filled";
        } else if (incomingOrder.filledQty > 0) {
            incomingOrder.status = "partial";
            if (incomingOrder.type === "limit") book.bids.push(incomingOrder);
        } else {
            incomingOrder.status = "open";
            if (incomingOrder.type === "limit") book.bids.push(incomingOrder);
        }
    } else {
        // SELL order
        // sort bids descending — highest bid first (best for seller)
        book.bids.sort((a, b) => b.price - a.price);

        let remaining = incomingOrder.quantity;

        for (let i = 0; i < book.bids.length && remaining > 0; i++) {
            const bid = book.bids[i];

            // limit order: only match if bid price >= sell price
            if (
                incomingOrder.type === "limit" &&
                bid.price < incomingOrder.price
            )
                break;

            const fillQty = Math.min(remaining, bid.quantity - bid.filledQty);
            const fillPrice = bid.price;

            const trade = await executeFill(
                bid,
                incomingOrder,
                fillQty,
                fillPrice,
            );
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

        incomingOrder.filledQty = incomingOrder.quantity - remaining;
        if (remaining === 0) {
            incomingOrder.status = "filled";
        } else if (incomingOrder.filledQty > 0) {
            incomingOrder.status = "partial";
            if (incomingOrder.type === "limit") book.asks.push(incomingOrder);
        } else {
            incomingOrder.status = "open";
            if (incomingOrder.type === "limit") book.asks.push(incomingOrder);
        }
    }

    return trades;
}

async function executeFill(
    buyOrder: any,
    sellOrder: any,
    fillQty: number,
    fillPrice: number,
) {
    const cost = fillPrice * fillQty;

    // all db writes in one transaction
    return await prisma.$transaction(async (tx) => {
        // 1. create trade record
        const trade = await tx.trade.create({
            data: {
                buyOrderId: buyOrder.id,
                sellOrderId: sellOrder.id,
                pair: buyOrder.pair,
                price: fillPrice,
                qty: fillQty,
                buyerFee: 0, // demo: no fees
                sellerFee: 0,
            },
        });

        // 2. update both orders in db
        await tx.order.update({
            where: { id: buyOrder.id },
            data: {
                filledQty: { increment: fillQty },
                status: buyOrder.status,
            },
        });

        await tx.order.update({
            where: { id: sellOrder.id },
            data: {
                filledQty: { increment: fillQty },
                status: sellOrder.status,
            },
        });

        // 3. settle balances
        // buyer: deduct reserved quote (USDT), credit base (BTC)
        await tx.balance.update({
            where: {
                userId_asset: {
                    userId: buyOrder.userId,
                    asset: buyOrder.quoteAsset,
                },
            },
            data: { reserved: { decrement: cost } },
        });
        await tx.balance.upsert({
            where: {
                userId_asset: {
                    userId: buyOrder.userId,
                    asset: buyOrder.baseAsset,
                },
            },
            update: { available: { increment: fillQty } },
            create: {
                userId: buyOrder.userId,
                asset: buyOrder.baseAsset,
                available: fillQty,
                reserved: 0,
            },
        });

        // seller: deduct reserved base (BTC), credit quote (USDT)
        await tx.balance.update({
            where: {
                userId_asset: {
                    userId: sellOrder.userId,
                    asset: sellOrder.baseAsset,
                },
            },
            data: { reserved: { decrement: fillQty } },
        });
        await tx.balance.upsert({
            where: {
                userId_asset: {
                    userId: sellOrder.userId,
                    asset: sellOrder.quoteAsset,
                },
            },
            update: { available: { increment: cost } },
            create: {
                userId: sellOrder.userId,
                asset: sellOrder.quoteAsset,
                available: cost,
                reserved: 0,
            },
        });

        // 4. ledger events for both sides
        await tx.ledgerEvent.createMany({
            data: [
                {
                    userId: buyOrder.userId,
                    tradeId: trade.id,
                    asset: buyOrder.quoteAsset,
                    eventType: "trade_debit",
                    delta: -cost,
                    balanceAfter: 0,
                },
                {
                    userId: buyOrder.userId,
                    tradeId: trade.id,
                    asset: buyOrder.baseAsset,
                    eventType: "trade_credit",
                    delta: fillQty,
                    balanceAfter: 0,
                },
                {
                    userId: sellOrder.userId,
                    tradeId: trade.id,
                    asset: sellOrder.baseAsset,
                    eventType: "trade_debit",
                    delta: -fillQty,
                    balanceAfter: 0,
                },
                {
                    userId: sellOrder.userId,
                    tradeId: trade.id,
                    asset: sellOrder.quoteAsset,
                    eventType: "trade_credit",
                    delta: cost,
                    balanceAfter: 0,
                },
            ],
        });

        return trade;
    });
}

// called on server start — load open orders from db into memory
export async function loadOrderBook() {
    const openOrders = await prisma.order.findMany({
        where: { status: { in: ["open", "partial"] } },
        include: { market: true },
    });

    for (const order of openOrders) {
        const book = getBook(order.market.pair);
        const entry = { ...order, pair: order.market.pair };
        if (order.side === "buy") book.bids.push(entry);
        else book.asks.push(entry);
    }

    console.log(`loaded ${openOrders.length} open orders into memory`);
}
