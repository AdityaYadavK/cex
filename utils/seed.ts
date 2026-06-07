import { prisma } from "./db.ts";
import bcrypt from "bcrypt";

// Helper function to generate random number in range
function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to generate random decimal
function randomDecimal(min: number, max: number, decimals: number = 2): number {
    const num = Math.random() * (max - min) + min;
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Helper function to pick random item from array
function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Asset definitions with realistic price ranges
const ASSETS = {
    BTC: { priceRange: [65000, 75000], volatility: 0.02 },
    ETH: { priceRange: [2500, 3500], volatility: 0.03 },
    SOL: { priceRange: [140, 180], volatility: 0.05 },
    BNB: { priceRange: [500, 650], volatility: 0.03 },
    XRP: { priceRange: [0.45, 0.65], volatility: 0.04 },
    ADA: { priceRange: [0.35, 0.55], volatility: 0.05 },
    DOGE: { priceRange: [0.08, 0.18], volatility: 0.08 },
    AVAX: { priceRange: [30, 45], volatility: 0.06 },
    LINK: { priceRange: [12, 20], volatility: 0.05 },
    DOT: { priceRange: [6, 9], volatility: 0.05 },
    USDT: { priceRange: [0.99, 1.01], volatility: 0.001 },
};

// Trading pairs configuration
const TRADING_PAIRS = [
    { pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", minOrder: 0.001, tickSize: 0.01, makerFee: 0.1, takerFee: 0.1 },
    { pair: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", minOrder: 0.01, tickSize: 0.01, makerFee: 0.1, takerFee: 0.1 },
    { pair: "SOL/USDT", baseAsset: "SOL", quoteAsset: "USDT", minOrder: 0.1, tickSize: 0.001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "BNB/USDT", baseAsset: "BNB", quoteAsset: "USDT", minOrder: 0.01, tickSize: 0.01, makerFee: 0.1, takerFee: 0.1 },
    { pair: "XRP/USDT", baseAsset: "XRP", quoteAsset: "USDT", minOrder: 10, tickSize: 0.0001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "ADA/USDT", baseAsset: "ADA", quoteAsset: "USDT", minOrder: 10, tickSize: 0.0001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "DOGE/USDT", baseAsset: "DOGE", quoteAsset: "USDT", minOrder: 100, tickSize: 0.00001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "AVAX/USDT", baseAsset: "AVAX", quoteAsset: "USDT", minOrder: 0.1, tickSize: 0.001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "LINK/USDT", baseAsset: "LINK", quoteAsset: "USDT", minOrder: 1, tickSize: 0.01, makerFee: 0.1, takerFee: 0.1 },
    { pair: "DOT/USDT", baseAsset: "DOT", quoteAsset: "USDT", minOrder: 1, tickSize: 0.001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "ETH/BTC", baseAsset: "ETH", quoteAsset: "BTC", minOrder: 0.001, tickSize: 0.00001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "SOL/BTC", baseAsset: "SOL", quoteAsset: "BTC", minOrder: 0.01, tickSize: 0.000001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "BNB/BTC", baseAsset: "BNB", quoteAsset: "BTC", minOrder: 0.001, tickSize: 0.00001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "XRP/BTC", baseAsset: "XRP", quoteAsset: "BTC", minOrder: 1, tickSize: 0.0000001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "DOGE/BTC", baseAsset: "DOGE", quoteAsset: "BTC", minOrder: 10, tickSize: 0.00000001, makerFee: 0.1, takerFee: 0.1 },
    { pair: "SHIB/USDT", baseAsset: "SHIB", quoteAsset: "USDT", minOrder: 1000, tickSize: 0.000001, makerFee: 0.1, takerFee: 0.1 },
];

// User data
const USERS = [
    { email: "trader1@example.com", password: "password123" },
    { email: "trader2@example.com", password: "password123" },
    { email: "trader3@example.com", password: "password123" },
    { email: "whale@example.com", password: "password123" },
    { email: "bot@example.com", password: "password123" },
];

async function main() {
    console.log("🌱 Starting seed process...");

    // Clean existing data (optional - comment out if you want to preserve data)
    console.log("🧹 Cleaning existing data...");
    await prisma.ledgerEvent.deleteMany();
    await prisma.trade.deleteMany();
    await prisma.order.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.balance.deleteMany();
    await prisma.user.deleteMany();
    await prisma.market.deleteMany();

    // Create markets
    console.log("📊 Creating markets...");
    const markets = await prisma.market.createMany({
        data: TRADING_PAIRS.map(p => ({
            pair: p.pair,
            baseAsset: p.baseAsset,
            quoteAsset: p.quoteAsset,
            minOrder: Math.round(p.minOrder * 100), // Convert to integer (2 decimals)
            tickSize: Math.round(p.tickSize * 100), // Convert to integer (2 decimals)
            makerFee: Math.round(p.makerFee * 100), // Convert to basis points
            takerFee: Math.round(p.takerFee * 100), // Convert to basis points
            status: p.pair === "SHIB/USDT" ? "inactive" : "active",
        })),
        skipDuplicates: true,
    });
    console.log(`   Created ${markets.count} markets`);

    // Get market IDs for later use
    const marketRecords = await prisma.market.findMany();
    const marketMap = new Map(marketRecords.map(m => [m.pair, m.id]));

    // Create users
    console.log("👤 Creating users...");
    const createdUsers = [];
    for (const userData of USERS) {
        const hashedPassword = await bcrypt.hash(userData.password, 11);
        const user = await prisma.user.create({
            data: {
                email: userData.email,
                password: hashedPassword,
            },
        });
        createdUsers.push(user);
    }
    console.log(`   Created ${createdUsers.length} users`);

    // Create balances for each user
    console.log("💰 Creating user balances...");
    for (const user of createdUsers) {
        // Give each user different amounts to create diverse scenarios
        const isWhale = user.email === "whale@example.com";
        const isBot = user.email === "bot@example.com";

        for (const [asset, config] of Object.entries(ASSETS)) {
            const baseAmount = isWhale ? randomInt(100, 500) : (isBot ? randomInt(50, 100) : randomInt(1, 20));
            const multiplier = asset === "USDT" ? 1000 : (asset === "BTC" ? 1 : 10);
            const available = Math.round(baseAmount * multiplier * 100); // Convert to 2 decimals

            await prisma.balance.upsert({
                where: {
                    userId_asset: {
                        userId: user.id,
                        asset: asset,
                    },
                },
                create: {
                    userId: user.id,
                    asset: asset,
                    available: available,
                    reserved: 0,
                },
                update: {}, // Don't update existing balances
            });
        }
    }
    console.log("   Balances created for all users");

    // Create orders and trades
    console.log("📈 Creating orders and trades...");
    const orderStatuses = ["open", "partial", "filled", "cancelled"];
    const orderTypes = ["limit", "market"];
    const orderSides = ["buy", "sell"];

    // Only create orders for the first 5 active markets for performance
    const activeMarkets = marketRecords.filter(m => m.status === "active").slice(0, 5);

    for (const market of activeMarkets) {

        const [baseAsset, quoteAsset] = market.pair.split("/");
        const baseConfig = ASSETS[baseAsset as keyof typeof ASSETS];
        const quoteConfig = ASSETS[quoteAsset as keyof typeof ASSETS];

        if (!baseConfig || !quoteConfig) continue;

        // Generate realistic price for this pair
        const basePrice = randomDecimal(baseConfig.priceRange[0], baseConfig.priceRange[1], 2);
        const quotePrice = randomDecimal(quoteConfig.priceRange[0], quoteConfig.priceRange[1], 2);
        const pairPrice = baseAsset === "USDT" ? quotePrice : (quoteAsset === "USDT" ? basePrice : basePrice / quotePrice);

        // Create orders for each user (limit to 2-3 orders per user per market for performance)
        for (const user of createdUsers) {
            const numOrders = randomInt(2, 3);

            for (let i = 0; i < numOrders; i++) {
                const side = randomPick(orderSides);
                const type = randomPick(orderTypes);
                const status = randomPick(orderStatuses);

                // Generate price around current market price with some spread
                const spread = randomDecimal(-0.02, 0.02, 4); // ±2% spread
                const price = Math.round((pairPrice * (1 + spread)) * 100); // Convert to 2 decimals

                // Generate quantity
                const minOrder = market.minOrder / 100; // Convert back from integer
                const maxQuantity = randomInt(Math.round(minOrder * 10), Math.round(minOrder * 100));
                const quantity = Math.round(randomDecimal(minOrder, maxQuantity, 2) * 100); // Convert to 2 decimals

                let filledQty = 0;
                if (status === "partial") {
                    filledQty = Math.round(quantity * randomDecimal(0.1, 0.9, 2));
                } else if (status === "filled") {
                    filledQty = quantity;
                }

                const avgFillPrice = filledQty > 0 ? Math.round(price * randomDecimal(0.98, 1.02, 4)) : 0;

                const order = await prisma.order.create({
                    data: {
                        userId: user.id,
                        marketId: market.id,
                        pair: market.pair,
                        side: side,
                        type: type,
                        price: price,
                        quantity: quantity,
                        filledQty: filledQty,
                        avgFillPrice: avgFillPrice,
                        status: status,
                        createdAt: new Date(Date.now() - randomInt(0, 7 * 24 * 60 * 60 * 1000)), // Random time in last 7 days
                    },
                });

                // Create trades for filled/partial orders (limit to 1-2 trades per order for performance)
                if (filledQty > 0) {
                    const numTrades = status === "filled" ? randomInt(1, 2) : 1;
                    let remainingFillQty = filledQty;

                    for (let j = 0; j < numTrades && remainingFillQty > 0; j++) {
                        const tradeQty = Math.min(remainingFillQty, Math.round(filledQty / numTrades));
                        remainingFillQty -= tradeQty;

                        const tradePrice = Math.round(price * randomDecimal(0.99, 1.01, 4));
                        const buyerFee = Math.round(tradeQty * tradePrice * 0.001); // 0.1% fee
                        const sellerFee = Math.round(tradeQty * tradePrice * 0.001); // 0.1% fee

                        // Create matching counter-order (simplified)
                        const counterSide = side === "buy" ? "sell" : "buy";
                        const otherUser = randomPick(createdUsers.filter(u => u.id !== user.id));

                        const counterOrder = await prisma.order.create({
                            data: {
                                userId: otherUser.id,
                                marketId: market.id,
                                pair: market.pair,
                                side: counterSide,
                                type: "limit",
                                price: tradePrice,
                                quantity: tradeQty,
                                filledQty: tradeQty,
                                avgFillPrice: tradePrice,
                                status: "filled",
                                createdAt: order.createdAt,
                            },
                        });

                        const trade = await prisma.trade.create({
                            data: {
                                buyOrderId: side === "buy" ? order.id : counterOrder.id,
                                sellOrderId: side === "sell" ? order.id : counterOrder.id,
                                pair: market.pair,
                                price: tradePrice,
                                qty: tradeQty,
                                buyerFee: buyerFee,
                                sellerFee: sellerFee,
                                executedAt: new Date(order.createdAt.getTime() + randomInt(0, 60000)),
                            },
                        });

                        // Create ledger events for the trade
                        const asset = side === "buy" ? baseAsset : quoteAsset;
                        const delta = side === "buy" ? tradeQty : Math.round(tradeQty * tradePrice / 100);

                        await prisma.ledgerEvent.create({
                            data: {
                                userId: user.id,
                                asset: asset,
                                eventType: "trade",
                                delta: delta,
                                balanceAfter: 0, // Would need to calculate actual balance
                                tradeId: trade.id,
                            },
                        });

                        await prisma.ledgerEvent.create({
                            data: {
                                userId: otherUser.id,
                                asset: asset,
                                eventType: "trade",
                                delta: -delta,
                                balanceAfter: 0, // Would need to calculate actual balance
                                tradeId: trade.id,
                            },
                        });
                    }
                }

                // Create deposit transactions for some users (only for first user, first order per market)
                if (i === 0 && user.email === "trader1@example.com") {
                    const asset = randomPick(Object.keys(ASSETS));
                    const amount = Math.round(randomDecimal(100, 10000, 2) * 100);

                    await prisma.transaction.create({
                        data: {
                            userId: user.id,
                            type: "Deposit",
                            asset: asset,
                            amount: amount,
                            status: "Complete",
                            direction: "in",
                        },
                    });

                    // Create corresponding ledger event
                    await prisma.ledgerEvent.create({
                        data: {
                            userId: user.id,
                            asset: asset,
                            eventType: "deposit",
                            delta: amount,
                            balanceAfter: amount, // Simplified
                        },
                    });
                }
            }
        }
    }
    console.log("   Orders and trades created");

    // Create specific orderbook data for all active markets
    console.log("📚 Creating orderbook data for all pairs...");
    for (const market of marketRecords) {
        if (market.status === "inactive") continue;

        const [baseAsset, quoteAsset] = market.pair.split("/");
        const baseConfig = ASSETS[baseAsset as keyof typeof ASSETS];
        const quoteConfig = ASSETS[quoteAsset as keyof typeof ASSETS];
        
        if (!baseConfig || !quoteConfig) continue;

        // Generate base price for this pair
        const basePrice = randomDecimal(baseConfig.priceRange[0], baseConfig.priceRange[1], 2);
        const quotePrice = randomDecimal(quoteConfig.priceRange[0], quoteConfig.priceRange[1], 2);
        const pairPrice = baseAsset === "USDT" ? quotePrice : (quoteAsset === "USDT" ? basePrice : basePrice / quotePrice);

        // Create bid orders (buy orders) - descending price
        const numBids = randomInt(8, 15);
        for (let i = 0; i < numBids; i++) {
            const spread = randomDecimal(-0.05, -0.001, 4); // Negative spread for bids (below market price)
            const price = Math.round((pairPrice * (1 + spread)) * 100);
            const minOrder = Math.max(1, market.minOrder / 100); // Ensure at least 1
            const quantity = Math.max(1, Math.round(randomDecimal(minOrder, minOrder * randomInt(5, 20), 2) * 100)); // Ensure at least 1
            
            const user = randomPick(createdUsers);
            
            await prisma.order.create({
                data: {
                    userId: user.id,
                    marketId: market.id,
                    pair: market.pair,
                    side: "buy",
                    type: "limit",
                    price: price,
                    quantity: quantity,
                    filledQty: 0,
                    avgFillPrice: 0,
                    status: "open",
                    createdAt: new Date(Date.now() - randomInt(0, 3600000)), // Last hour
                },
            });
        }

        // Create ask orders (sell orders) - ascending price
        const numAsks = randomInt(8, 15);
        for (let i = 0; i < numAsks; i++) {
            const spread = randomDecimal(0.001, 0.05, 4); // Positive spread for asks (above market price)
            const price = Math.round((pairPrice * (1 + spread)) * 100);
            const minOrder = Math.max(1, market.minOrder / 100); // Ensure at least 1
            const quantity = Math.max(1, Math.round(randomDecimal(minOrder, minOrder * randomInt(5, 20), 2) * 100)); // Ensure at least 1
            
            const user = randomPick(createdUsers);
            
            await prisma.order.create({
                data: {
                    userId: user.id,
                    marketId: market.id,
                    pair: market.pair,
                    side: "sell",
                    type: "limit",
                    price: price,
                    quantity: quantity,
                    filledQty: 0,
                    avgFillPrice: 0,
                    status: "open",
                    createdAt: new Date(Date.now() - randomInt(0, 3600000)), // Last hour
                },
            });
        }
    }
    console.log("   Orderbook data created for all active pairs");

    console.log("✅ Seed completed successfully!");
    console.log(`   - ${marketRecords.length} markets`);
    console.log(`   - ${createdUsers.length} users`);
    console.log(`   - Multiple balances per user`);
    console.log(`   - Historical orders and trades`);
    console.log(`   - Live orderbook data for all pairs`);
    console.log(`   - Deposit transactions and ledger events`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
