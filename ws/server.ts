import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";

const ordersubs = new Map<string, Set<WebSocket>>();
const tradesubs = new Map<string, Set<WebSocket>>();

export function init(server: Server) {
    const wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        const url = new URL(req.url!, `http://localhost`);
        const parts = url.pathname.split("/").filter(Boolean);

        const channel = parts[1];
        const rawpair = parts[2];

        if (!channel || !rawpair) {
            ws.close(1008, "invalid path");
            return;
        }

        const pair = rawpair.replace("-", "/");
        if (channel === "orderbook") {
            subscribe(ordersubs, pair, ws);
        } else if (channel === "trade") {
            subscribe(tradesubs, pair, ws);
        } else {
            ws.close(1008, "unknown channel");
            return;
        }

        ws.on("close", () => {
            unsubscribe(ordersubs, pair, ws);
            unsubscribe(tradesubs, pair, ws);
        });

        ws.on("error", () => {
            unsubscribe(ordersubs, pair, ws);
            unsubscribe(tradesubs, pair, ws);
        });
    });
    console.log("web socket event ready");
}

function subscribe(
    map: Map<string, Set<WebSocket>>,
    pair: string,
    ws: WebSocket,
) {
    if (!map.has(pair)) {
        map.set(pair, new Set());
    }
    map.get(pair)!.add(ws);
}

function unsubscribe(
    map: Map<string, Set<WebSocket>>,
    pair: string,
    ws: WebSocket,
) {
    map.get(pair)?.delete(ws);
}

// broadcast to all client subscribed to a pair
export function broadcastorderbook(pair: string, payload: object) {
    broadcast(ordersubs, pair, { channel: "orderbook", pair, ...payload });
}

export function broadcasttrade(pair: string, payload: object) {
    broadcast(tradesubs, pair, { channel: "trade", pair, ...payload });
}

function broadcast(
    map: Map<string, Set<WebSocket>>,
    pair: string,
    data: object,
) {
    const clients = map.get(pair);
    if (!clients || clients.size === 0) return;

    const msg = JSON.stringify(data);

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}
