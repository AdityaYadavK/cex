import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/db.ts";

const ordersubs = new Map<string, Set<WebSocket>>();
const tradesubs = new Map<string, Set<WebSocket>>();

// Store user ID with WebSocket connection
const wsUsers = new Map<WebSocket, string>();

async function authenticateWebSocket(req: IncomingMessage): Promise<string | null> {
    try {
        const url = new URL(req.url!, `http://localhost`);
        const token = url.searchParams.get("token");
        
        if (!token) return null;

        const payload = jwt.verify(token, process.env.JWT_SECRET || "maxver");
        if (typeof payload === "string") return null;
        
        const userId = (payload as any).id;
        if (!userId) return null;

        // Verify user exists
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        return user ? userId : null;
    } catch (error) {
        return null;
    }
}

export function init(server: Server) {
    const wss = new WebSocketServer({ server, path: process.env.WS_PATH || "/ws" });

    wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
        // Authenticate WebSocket connection
        const userId = await authenticateWebSocket(req);
        if (!userId) {
            ws.close(1008, "authentication failed");
            return;
        }

        wsUsers.set(ws, userId);

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
            wsUsers.delete(ws);
        });

        ws.on("error", () => {
            unsubscribe(ordersubs, pair, ws);
            unsubscribe(tradesubs, pair, ws);
            wsUsers.delete(ws);
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
