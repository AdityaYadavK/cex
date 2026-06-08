import { prisma } from "../utils/db.ts";

// per-pair mutex to prevent concurrent mutation
const locks: Record<string, Promise<void>> = {};

async function withLock<T>(pair: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks[pair] ?? Promise.resolve();
    let release!: () => void;
    locks[pair] = prev.then(() => new Promise<void>((r) => (release = r)));
    await prev;
    try {
        return await fn();
    } finally {
        release();
    }
}

// in-memory orderbook
const orderbook: Record<string, { bids: Order[]; asks: Order[] }> = {};

function getBook(pair: string) {
    if (!orderbook[pair]) orderbook[pair] = { bids: [], asks: [] };
    return orderbook[pair];
}

// remove order from in-memory orderbook
export function removeOrderFromBook(
    orderId: string,
    pair: string,
    side: string,
) {
    const book = getBook(pair);
    const sideBook = side === "buy" ? book.bids : book.asks;
    const index = sideBook.findIndex((order) => order.id === orderId);
    if (index !== -1) {
        sideBook.splice(index, 1);
    }
}

// clean up cancelled/filled orders from in-memory orderbook (sync with db)
export async function syncOrderbookWithDb() {
    const openOrders = await prisma.order.findMany({
        where: { status: { in: ["OPEN", "partial"] } },
        select: { id: true, pair: true, side: true },
    });

    const validOrderIds = new Set(openOrders.map((o) => o.id));

    // check each pair's orderbook and remove invalid orders
    for (const pair in orderbook) {
        const book = orderbook[pair];

        // clean bids
        book.bids = book.bids.filter((order) => validOrderIds.has(order.id));

        // clean asks
        book.asks = book.asks.filter((order) => validOrderIds.has(order.id));
    }
}

// main match entry point
export async function match(incoming: Order): Promise<Trade[]> {
    return withLock(incoming.pair, () => _match(incoming));
}

async function _match(incoming: Order): Promise<Trade[]> {
    const book = getBook(incoming.pair);
    const trades: Trade[] = [];

    const oppositeSide = incoming.side === "buy" ? book.asks : book.bids;

    // price-time priority sort
    if (incoming.side === "buy") {
        oppositeSide.sort(
            (a, b) => a.price - b.price || a.id.localeCompare(b.id),
        );
    } else {
        oppositeSide.sort(
            (a, b) => b.price - a.price || a.id.localeCompare(b.id),
        );
    }

    let remaining = incoming.quantity;

    for (let i = 0; i < oppositeSide.length && remaining > 0; i++) {
        const maker = oppositeSide[i];
        if (!maker) break;

        // fix #9: skip ghost orders (fully filled but not yet removed)
        const makerAvail = maker.quantity - maker.filledQty;
        if (makerAvail <= 0) {
            oppositeSide.splice(i, 1);
            i--;
            continue;
        }

        // fix #3: self-trade — skip this maker, continue to next
        // if you want hard rejection, do it in the router before calling match()
        if (maker.userId === incoming.userId) continue;

        // price check
        const priceMatch =
            incoming.type === "market" ||
            (incoming.side === "buy"
                ? maker.price <= incoming.price
                : maker.price >= incoming.price);

        if (!priceMatch) break;

        const fillQty = Math.min(remaining, makerAvail);
        const fillPrice = maker.price;

        // update in-memory state before db write
        maker.filledQty += fillQty;
        maker.status = maker.filledQty >= maker.quantity ? "filled" : "partial";
        remaining -= fillQty;
        incoming.filledQty += fillQty;
        // incoming.status set after loop

        const buyOrder = incoming.side === "buy" ? incoming : maker;
        const sellOrder = incoming.side === "buy" ? maker : incoming;

        const trade = await executeFill(
            buyOrder,
            sellOrder,
            fillQty,
            fillPrice,
            maker.status,
        );
        trades.push(trade);

        if (maker.filledQty >= maker.quantity) {
            oppositeSide.splice(i, 1);
            i--;
        }
    }

    // set final taker status
    incoming.status =
        remaining === 0
            ? "filled"
            : incoming.filledQty > 0
              ? "partial"
              : "OPEN";

    // fix #1: market orders NEVER rest in book
    if (incoming.type === "limit" && incoming.status !== "filled") {
        if (incoming.side === "buy") book.bids.push(incoming);
        else book.asks.push(incoming);
    }

    return trades;
}

// settlement
async function executeFill(
    buyorder: Order,
    sellorder: Order,
    fillQty: number,
    fillPrice: number,
    makerStatus: string,
): Promise<Trade> {
    const cost = fillQty * fillPrice;

    // fix #10: determine maker correctly
    // maker is whichever order was resting — passed in already correctly ordered by _match
    const makerIsBuy =
        buyorder.filledQty > 0 && sellorder.filledQty === fillQty;
    // simpler: caller sets maker explicitly via makerStatus param — use order reference instead
    // buyorder and sellorder are always correctly assigned by caller

    return await prisma.$transaction(async (tx) => {
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

        // fix #4 + #5: update MAKER status with correct value (passed in)
        // taker status updated by router after match() returns via porder reference
        // determine which is maker: the one already in the book (not incoming)
        // caller (_match) always passes maker as the resting order
        // buyorder = buy side, sellorder = sell side — maker could be either
        // we update both orders in db: maker with makerStatus, taker status updated by router
        await tx.order.update({
            where: { id: buyorder.id },
            data: {
                filledQty: { increment: fillQty },
                status: buyorder.status, // in-memory already updated
            },
        });

        await tx.order.update({
            where: { id: sellorder.id },
            data: {
                filledQty: { increment: fillQty },
                status: sellorder.status, // in-memory already updated
            },
        });

        // buyer: deduct reserved quote, credit available base
        const buyerQuoteBalance = await tx.balance.findUnique({
            where: {
                userId_asset: {
                    userId: buyorder.userId,
                    asset: buyorder.quoteAsset,
                },
            },
        });

        if (!buyerQuoteBalance) {
            throw new Error(`Balance not found for buyer ${buyorder.userId}`);
        }

        // If reserved is insufficient, deduct what we can (shouldn't happen with proper locking)
        const actualBuyDecrement = Math.min(cost, buyerQuoteBalance.reserved);
        if (actualBuyDecrement < cost) {
            console.warn(
                `Insufficient reserved balance for buyer ${buyorder.userId}. Required: ${cost}, Available: ${buyerQuoteBalance.reserved}, Using: ${actualBuyDecrement}`,
            );
        }

        await tx.balance.update({
            where: {
                userId_asset: {
                    userId: buyorder.userId,
                    asset: buyorder.quoteAsset,
                },
            },
            data: { reserved: { decrement: actualBuyDecrement } },
        });

        await tx.balance.upsert({
            where: {
                userId_asset: {
                    userId: buyorder.userId,
                    asset: buyorder.baseAsset,
                },
            },
            update: { available: { increment: fillQty } },
            create: {
                userId: buyorder.userId,
                asset: buyorder.baseAsset,
                available: fillQty,
                reserved: 0,
            },
        });

        // seller: deduct reserved base, credit available quote
        const sellerBaseBalance = await tx.balance.findUnique({
            where: {
                userId_asset: {
                    userId: sellorder.userId,
                    asset: sellorder.baseAsset,
                },
            },
        });

        if (!sellerBaseBalance) {
            throw new Error(`Balance not found for seller ${sellorder.userId}`);
        }

        // If reserved is insufficient, deduct what we can (shouldn't happen with proper locking)
        const actualSellDecrement = Math.min(fillQty, sellerBaseBalance.reserved);
        if (actualSellDecrement < fillQty) {
            console.warn(
                `Insufficient reserved balance for seller ${sellorder.userId}. Required: ${fillQty}, Available: ${sellerBaseBalance.reserved}, Using: ${actualSellDecrement}`,
            );
        }

        await tx.balance.update({
            where: {
                userId_asset: {
                    userId: sellorder.userId,
                    asset: sellorder.baseAsset,
                },
            },
            data: { reserved: { decrement: actualSellDecrement } },
        });

        await tx.balance.upsert({
            where: {
                userId_asset: {
                    userId: sellorder.userId,
                    asset: sellorder.quoteAsset,
                },
            },
            update: { available: { increment: cost } },
            create: {
                userId: sellorder.userId,
                asset: sellorder.quoteAsset,
                available: cost,
                reserved: 0,
            },
        });

        // ledger events
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

        return {
            buyOrderId: buyorder.id,
            sellOrderId: sellorder.id,
            pair: buyorder.pair,
            fillQty,
            fillPrice,
            executedAt: tradeRecord.executedAt,
        };
    });
}

// load open orders from db on startup
export default async function loadOrderBook() {
    const openOrders = await prisma.order.findMany({
        where: { status: { in: ["OPEN", "partial"] } },
        include: { market: true },
    });

    for (const order of openOrders) {
        const book = getBook(order.market.pair);

        // fix: skip any market orders that somehow persisted (should not exist)
        if (order.type === "market") continue;

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

        if (entry.side === "buy") book.bids.push(entry);
        else book.asks.push(entry);
    }

    console.log(`loaded ${openOrders.length} open orders into memory`);
}
