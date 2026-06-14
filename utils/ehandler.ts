// middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";
import { logger } from "./logger.ts";

const ehandler: ErrorRequestHandler = (err, req, res, next) => {
    const statusCode =
        typeof (err as any).statusCode === "number"
            ? (err as any).statusCode
            : 500;

    const message = err.message || "internal server error";
    const requestId = (req as any).id || "unknown";

    logger.error(`Request ${requestId} failed: ${message}`, err);

    res.status(statusCode).json({
        success: false,
        message,
        requestId,
    });
};

export default ehandler;
