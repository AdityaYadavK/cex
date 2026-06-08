type Order = {
    id: string;
    pair: string; // e.g. "BTC/USDT"
    side: string;
    type: string;
    price: number;
    quantity: number;
    filledQty: number;
    status: string;
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
    executedAt: Date;
};
