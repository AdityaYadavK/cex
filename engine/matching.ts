import { prisma } from "../utils/db.ts";
import { broadcasttrade, broadcastorderbook } from "../ws/server.ts";
import type { Order, Trade } from "../types.d.ts";

// per-pair mutex to prevent concurrent mutation
const locks: Record<string, { promise: Promise<void>; resolve: () => void }> =
    {};

async function withLock<T>(pair: string, fn: () => Promise<T>): Promise<T> {
    // Acquire lock for this pair
    while (locks[pair]) {
        await locks[pair].promise;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });

    locks[pair] = { promise, resolve };

    try {
        return await fn();
    } finally {
        // Release the lock
        resolve();
        delete locks[pair];
    }
}

// in-memory orderbook with price-time priority
const orderbook: Record<string, { bids: Order[]; asks: Order[] }> = {};

function getBook(pair: string) {
    if (!orderbook[pair]) orderbook[pair] = { bids: [], asks: [] };
    return orderbook[pair];
}

// Helper function to insert order in sorted position (price-time priority)
function insertOrderSorted(sideBook: Order[], order: Order, side: string) {
    if (side === "buy") {
        // Bids: descending price, then ascending time (id) for FIFO
        let insertIndex = sideBook.findIndex(
            (o) =>
                o.price < order.price ||
                (o.price === order.price && o.id.localeCompare(order.id) > 0),
        );
        if (insertIndex === -1) {
            sideBook.push(order);
        } else {
            sideBook.splice(insertIndex, 0, order);
        }
    } else {
        // Asks: ascending price, then ascending time (id) for FIFO
        let insertIndex = sideBook.findIndex(
            (o) =>
                o.price > order.price ||
                (o.price === order.price && o.id.localeCompare(order.id) > 0),
        );
        if (insertIndex === -1) {
            sideBook.push(order);
        } else {
            sideBook.splice(insertIndex, 0, order);
        }
    }
}

// Helper function to aggregate orders by price level (standard exchange orderbook format)
function aggregateByPriceLevel(orders: Order[]) {
    const priceLevels = new Map<
        number,
        { totalQty: number; orderCount: number; oldestTime: string }
    >();

    for (const order of orders) {
        const existing = priceLevels.get(order.price);
        const remainingQty = order.quantity - order.filledQty;

        if (existing) {
            existing.totalQty += remainingQty;
            existing.orderCount += 1;
            if (order.id.localeCompare(existing.oldestTime) < 0) {
                existing.oldestTime = order.id; // Using ID as time proxy
            }
        } else {
            priceLevels.set(order.price, {
                totalQty: remainingQty,
                orderCount: 1,
                oldestTime: order.id,
            });
        }
    }

    return Array.from(priceLevels.entries()).map(([price, data]) => ({
        price,
        totalQty: data.totalQty,
        orderCount: data.orderCount,
    }));
}

// Export function to get aggregated orderbook for a pair
export function getAggregatedOrderbook(pair: string) {
    const book = getBook(pair);
    return {
        bids: aggregateByPriceLevel(book.bids).sort(
            (a, b) => b.price - a.price,
        ), // descending
        asks: aggregateByPriceLevel(book.asks).sort(
            (a, b) => a.price - b.price,
        ), // ascending
    };
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
        if (!book) continue;

        // clean bids
        book.bids = book.bids.filter((order) => validOrderIds.has(order.id));

        // clean asks
        book.asks = book.asks.filter((order) => validOrderIds.has(order.id));
    }
}

// main match entry point
export async function match(incoming: Order): Promise<Trade[]> {
    // Validate incoming order
    if (!incoming.id || !incoming.pair || !incoming.side || !incoming.type) {
        throw new Error("Invalid order: missing required fields");
    }

    if (incoming.quantity <= 0) {
        throw new Error("Invalid order: quantity must be positive");
    }

    if (incoming.type === "limit" && (!incoming.price || incoming.price <= 0)) {
        throw new Error("Invalid limit order: price must be positive");
    }

    if (!["buy", "sell"].includes(incoming.side)) {
        throw new Error("Invalid order: side must be 'buy' or 'sell'");
    }

    if (!["limit", "market"].includes(incoming.type)) {
        throw new Error("Invalid order: type must be 'limit' or 'market'");
    }

    return withLock(incoming.pair, () => _match(incoming));
}

async function _match(incoming: Order): Promise<Trade[]> {
    const book = getBook(incoming.pair);
    const trades: Trade[] = [];

    const oppositeSide = incoming.side === "buy" ? book.asks : book.bids;

    // No need to sort - orderbook is maintained in sorted order
    // However, we should verify sorting for safety in production
    if (process.env.NODE_ENV === "development") {
        if (incoming.side === "buy") {
            oppositeSide.sort(
                (a, b) => a.price - b.price || a.id.localeCompare(b.id),
            );
        } else {
            oppositeSide.sort(
                (a, b) => b.price - a.price || a.id.localeCompare(b.id),
            );
        }
    }

    let remaining = incoming.quantity;
    let filledSoFar = 0;

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

        const buyOrder = incoming.side === "buy" ? incoming : maker;
        const sellOrder = incoming.side === "buy" ? maker : incoming;

        // Execute fill with database transaction
        const trade = await executeFill(
            buyOrder,
            sellOrder,
            fillQty,
            fillPrice,
            incoming, // Pass incoming order to determine maker/taker
        );
        trades.push(trade);

        // Update in-memory state to match database state AFTER successful transaction
        // Use the status that was calculated in the database transaction
        maker.filledQty += fillQty;
        const newMakerFilledQty = maker.filledQty;
        maker.status =
            newMakerFilledQty >= maker.quantity
                ? "filled"
                : newMakerFilledQty > 0
                  ? "partial"
                  : "OPEN";

        remaining -= fillQty;
        filledSoFar += fillQty;

        if (maker.filledQty >= maker.quantity) {
            oppositeSide.splice(i, 1);
            i--;

            // Broadcast orderbook update for removed order
            broadcastorderbook(incoming.pair, {
                type: "remove",
                order: {
                    id: maker.id,
                    side: maker.side,
                    price: maker.price,
                    quantity: maker.quantity,
                    status: maker.status,
                },
            });
        }
    }

    // set final taker status based on actual fills
    incoming.filledQty = filledSoFar;
    incoming.status =
        remaining === 0 ? "filled" : filledSoFar > 0 ? "partial" : "OPEN";

    // fix #1: market orders NEVER rest in book
    if (incoming.type === "limit" && incoming.status !== "filled") {
        // Use sorted insertion to maintain price-time priority
        insertOrderSorted(
            incoming.side === "buy" ? book.bids : book.asks,
            incoming,
            incoming.side,
        );

        // Broadcast orderbook update
        broadcastorderbook(incoming.pair, {
            type: "add",
            order: {
                id: incoming.id,
                side: incoming.side,
                price: incoming.price,
                quantity: incoming.quantity,
                status: incoming.status,
            },
        });
    }

    return trades;
}

// settlement
async function executeFill(
    buyorder: Order,
    sellorder: Order,
    fillQty: number,
    fillPrice: number,
    incomingOrder: Order, // Pass the incoming order to determine maker/taker
): Promise<Trade> {
    // Validate fill parameters
    if (fillQty <= 0) {
        throw new Error("Invalid fill quantity: must be positive");
    }

    if (fillPrice <= 0) {
        throw new Error("Invalid fill price: must be positive");
    }

    if (!buyorder.id || !sellorder.id) {
        throw new Error("Invalid orders: missing order IDs");
    }

    const cost = fillQty * fillPrice;

    // Get market configuration for fee calculation
    const market = await prisma.market.findUnique({
        where: { pair: buyorder.pair },
        select: { makerFee: true, takerFee: true, status: true },
    });

    if (!market) {
        throw new Error(`Market not found for pair ${buyorder.pair}`);
    }

    if (market.status !== "active") {
        throw new Error(`Market ${buyorder.pair} is not active`);
    }

    if (market.makerFee < 0 || market.takerFee < 0) {
        throw new Error(
            `Invalid fee configuration for market ${buyorder.pair}`,
        );
    }

    // Determine maker and taker: maker is the order that was already in the book
    // incomingOrder is the taker (the order being matched now)
    const isBuyerMaker = buyorder.id !== incomingOrder.id;

    // Calculate fees
    // Buyer fee is deducted from the base asset they receive
    const buyerFee = Math.round(
        (fillQty * (isBuyerMaker ? market.makerFee : market.takerFee)) / 10000,
    );
    // Seller fee is deducted from the quote asset they receive
    const sellerFee = Math.round(
        (cost * (isBuyerMaker ? market.takerFee : market.makerFee)) / 10000,
    );

    return await prisma.$transaction(async (tx) => {
        try {
            const tradeRecord = await tx.trade.create({
                data: {
                    buyOrderId: buyorder.id,
                    sellOrderId: sellorder.id,
                    pair: buyorder.pair,
                    price: fillPrice,
                    qty: fillQty,
                    buyerFee,
                    sellerFee,
                },
            });

            // Update order statuses in database based on quantities
            // We need to fetch current order states to determine new statuses correctly
            const currentBuyOrder = await tx.order.findUnique({
                where: { id: buyorder.id },
                select: { quantity: true, filledQty: true },
            });

            const currentSellOrder = await tx.order.findUnique({
                where: { id: sellorder.id },
                select: { quantity: true, filledQty: true },
            });

            if (!currentBuyOrder || !currentSellOrder) {
                throw new Error("Order not found during transaction");
            }

            const newBuyFilledQty = currentBuyOrder.filledQty + fillQty;
            const newBuyStatus =
                newBuyFilledQty >= currentBuyOrder.quantity
                    ? "filled"
                    : newBuyFilledQty > 0
                      ? "partial"
                      : "OPEN";

            const newSellFilledQty = currentSellOrder.filledQty + fillQty;
            const newSellStatus =
                newSellFilledQty >= currentSellOrder.quantity
                    ? "filled"
                    : newSellFilledQty > 0
                      ? "partial"
                      : "OPEN";

            await tx.order.update({
                where: { id: buyorder.id },
                data: {
                    filledQty: { increment: fillQty },
                    status: newBuyStatus,
                },
            });

            await tx.order.update({
                where: { id: sellorder.id },
                data: {
                    filledQty: { increment: fillQty },
                    status: newSellStatus,
                },
            });

            // buyer: deduct reserved quote, credit available base minus fee
            const buyerQuoteBalance = await tx.balance.findUnique({
                where: {
                    userId_asset: {
                        userId: buyorder.userId,
                        asset: buyorder.quoteAsset,
                    },
                },
            });

            if (!buyerQuoteBalance) {
                throw new Error(
                    `Balance not found for buyer ${buyorder.userId}`,
                );
            }

            // Deduct from reserved quote balance
            const actualBuyDecrement = Math.min(
                cost,
                buyerQuoteBalance.reserved,
            );
            if (actualBuyDecrement < cost) {
                throw new Error(
                    `Insufficient reserved balance for buyer ${buyorder.userId}. Required: ${cost}, Available: ${buyerQuoteBalance.reserved}`,
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

            // Credit available base minus buyer fee
            const baseCredit = fillQty - buyerFee;
            if (baseCredit < 0) {
                throw new Error(
                    `Invalid fee calculation: base credit is negative ${baseCredit}`,
                );
            }

            await tx.balance.upsert({
                where: {
                    userId_asset: {
                        userId: buyorder.userId,
                        asset: buyorder.baseAsset,
                    },
                },
                update: { available: { increment: baseCredit } },
                create: {
                    userId: buyorder.userId,
                    asset: buyorder.baseAsset,
                    available: baseCredit,
                    reserved: 0,
                },
            });

            // seller: deduct reserved base, credit available quote minus fee
            const sellerBaseBalance = await tx.balance.findUnique({
                where: {
                    userId_asset: {
                        userId: sellorder.userId,
                        asset: sellorder.baseAsset,
                    },
                },
            });

            if (!sellerBaseBalance) {
                throw new Error(
                    `Balance not found for seller ${sellorder.userId}`,
                );
            }

            // Deduct from reserved base balance
            const actualSellDecrement = Math.min(
                fillQty,
                sellerBaseBalance.reserved,
            );
            if (actualSellDecrement < fillQty) {
                throw new Error(
                    `Insufficient reserved balance for seller ${sellorder.userId}. Required: ${fillQty}, Available: ${sellerBaseBalance.reserved}`,
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

            // Credit available quote minus seller fee
            const quoteCredit = cost - sellerFee;
            if (quoteCredit < 0) {
                throw new Error(
                    `Invalid fee calculation: quote credit is negative ${quoteCredit}`,
                );
            }

            await tx.balance.upsert({
                where: {
                    userId_asset: {
                        userId: sellorder.userId,
                        asset: sellorder.quoteAsset,
                    },
                },
                update: { available: { increment: quoteCredit } },
                create: {
                    userId: sellorder.userId,
                    asset: sellorder.quoteAsset,
                    available: quoteCredit,
                    reserved: 0,
                },
            });

            // ledger events with actual balance calculation including fees
            const buyerQuoteAfter = await tx.balance.findUnique({
                where: {
                    userId_asset: {
                        userId: buyorder.userId,
                        asset: buyorder.quoteAsset,
                    },
                },
            });

            const buyerBaseAfter = await tx.balance.findUnique({
                where: {
                    userId_asset: {
                        userId: buyorder.userId,
                        asset: buyorder.baseAsset,
                    },
                },
            });

            const sellerBaseAfter = await tx.balance.findUnique({
                where: {
                    userId_asset: {
                        userId: sellorder.userId,
                        asset: sellorder.baseAsset,
                    },
                },
            });

            const sellerQuoteAfter = await tx.balance.findUnique({
                where: {
                    userId_asset: {
                        userId: sellorder.userId,
                        asset: sellorder.quoteAsset,
                    },
                },
            });

            await tx.ledgerEvent.createMany({
                data: [
                    {
                        userId: buyorder.userId,
                        tradeId: tradeRecord.id,
                        asset: buyorder.quoteAsset,
                        eventType: "trade_debit",
                        delta: -cost,
                        balanceAfter: buyerQuoteAfter?.available || 0,
                    },
                    {
                        userId: buyorder.userId,
                        tradeId: tradeRecord.id,
                        asset: buyorder.baseAsset,
                        eventType: "trade_credit",
                        delta: baseCredit,
                        balanceAfter: buyerBaseAfter?.available || 0,
                    },
                    {
                        userId: buyorder.userId,
                        tradeId: tradeRecord.id,
                        asset: buyorder.baseAsset,
                        eventType: "fee",
                        delta: -buyerFee,
                        balanceAfter: buyerBaseAfter?.available || 0,
                    },
                    {
                        userId: sellorder.userId,
                        tradeId: tradeRecord.id,
                        asset: sellorder.baseAsset,
                        eventType: "trade_debit",
                        delta: -fillQty,
                        balanceAfter: sellerBaseAfter?.available || 0,
                    },
                    {
                        userId: sellorder.userId,
                        tradeId: tradeRecord.id,
                        asset: sellorder.quoteAsset,
                        eventType: "trade_credit",
                        delta: quoteCredit,
                        balanceAfter: sellerQuoteAfter?.available || 0,
                    },
                    {
                        userId: sellorder.userId,
                        tradeId: tradeRecord.id,
                        asset: sellorder.quoteAsset,
                        eventType: "fee",
                        delta: -sellerFee,
                        balanceAfter: sellerQuoteAfter?.available || 0,
                    },
                ],
            });

            // Broadcast trade to WebSocket subscribers (outside transaction but after success)
            broadcasttrade(buyorder.pair, {
                trade: {
                    id: tradeRecord.id,
                    price: fillPrice,
                    qty: fillQty,
                    executedAt: tradeRecord.executedAt,
                    buyOrderId: buyorder.id,
                    sellOrderId: sellorder.id,
                },
            });

            return {
                buyOrderId: buyorder.id,
                sellOrderId: sellorder.id,
                pair: buyorder.pair,
                fillQty,
                fillPrice,
                executedAt: tradeRecord.executedAt,
            };
        } catch (error) {
            // Log error and re-throw to trigger transaction rollback
            console.error(
                `Transaction failed for trade between ${buyorder.id} and ${sellorder.id}:`,
                error,
            );
            throw error;
        }
    });
}

// load open orders from db on startup
export default async function loadOrderBook() {
    const openOrders = await prisma.order.findMany({
        where: { status: { in: ["OPEN", "partial"] } },
        include: { market: true },
        orderBy: { createdAt: "asc" }, // Load in creation order for proper FIFO
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

        // Use sorted insertion to maintain price-time priority
        insertOrderSorted(
            entry.side === "buy" ? book.bids : book.asks,
            entry,
            entry.side,
        );
    }

    console.log(`loaded ${openOrders.length} open orders into memory`);
}
