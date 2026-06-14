import { hitlimit } from "@joint-ops/hitlimit";
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import helmet from "helmet";
import cors from "cors";
import signup from "./user/signup.ts";
import login from "./user/login.ts";
import logout from "./user/logout.ts";
import middleware from "./utils/middleware.ts";
import market from "./market/market.ts";
import orderbook from "./market/orderbook.ts";
import place from "./order/place.ts";
import list from "./order/list.ts";
import cancel from "./order/cancel.ts";
import balance from "./wallet/balance.ts";
import deposit from "./wallet/deposit.ts";
import withdraw from "./wallet/withdraw.ts";
import cp from "cookie-parser";
import ehandler from "./utils/ehandler.ts";
import tlist from "./trades/list.ts";
import loadOrderBook from "./engine/matching.ts";
import { init as initWebSocket } from "./ws/server.ts";
import { logger } from "./utils/logger.ts";

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: process.env.CORS_CREDENTIALS === "true",
}));

// Request ID tracking
app.use((req: Request, res: Response, next: NextFunction) => {
    req.id = req.headers["x-request-id"] as string || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.setHeader("X-Request-ID", req.id);
    next();
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    logger.info(`${req.method} ${req.path}`, { requestId: req.id });
    
    res.on("finish", () => {
        const duration = Date.now() - start;
        logger.info(`${req.method} ${req.path} ${res.statusCode}`, { 
            requestId: req.id, 
            duration: `${duration}ms` 
        });
    });
    
    next();
});

// Request timeout middleware
const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT || "30000"); // 30 seconds default
app.use((req: Request, res: Response, next: NextFunction) => {
    res.setTimeout(requestTimeout, () => {
        logger.warn(`Request timeout for ${req.method} ${req.path}`, { requestId: req.id });
        if (!res.headersSent) {
            res.status(504).json({ 
                success: false, 
                message: "Request timeout",
                requestId: req.id 
            });
        }
    });
    next();
});

// Rate limiting
app.use(hitlimit({ limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "10"), window: process.env.RATE_LIMIT_WINDOW || "1m" }));
app.use(cp());

app.use(express.json({ limit: "10mb" })); // Add request size limit

// Health check endpoint with database status
app.get("/health", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { prisma } = await import("./utils/db.ts");
        
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;
        
        res.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: "connected",
            environment: process.env.NODE_ENV || "development",
        });
    } catch (error) {
        logger.error("Health check failed", error);
        res.status(503).json({
            status: "unhealthy",
            timestamp: new Date().toISOString(),
            database: "disconnected",
            error: "Database connection failed",
        });
    }
});

app.get("/", (req: Request, res: Response, next: NextFunction) => {
    res.json({ msg: "CEX API - Central Exchange", version: "1.0.0" });
});
app.use("/signup", signup);
app.use("/login", login);
app.use("/logout", logout);
app.use("/market", market);
app.use("/market", orderbook);
app.use("/wallet/balance", balance);
app.use("/wallet/deposit", deposit);
app.use("/wallet/withdraw", withdraw);
app.use("/order/place", place);
app.use("/order/list", list);
app.use("/order/cancel", cancel);
app.use("/trade/list", tlist);

app.use(ehandler);

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server
initWebSocket(server);

// Initialize orderbook on startup
loadOrderBook()
    .then(() => logger.info("Orderbook loaded successfully"))
    .catch((error) => {
        logger.error("Failed to load orderbook", error);
        process.exit(1);
    });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(() => {
        logger.info("HTTP server closed");
    });
    
    // Add cleanup for WebSocket, database connections, etc.
    // For now, just exit after a timeout
    setTimeout(() => {
        logger.info("Forcing shutdown after timeout");
        process.exit(1);
    }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", error);
    process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
});
