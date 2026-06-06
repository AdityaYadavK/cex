// middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";

const ehandler: ErrorRequestHandler = (err, req, res, next) => {
    const statusCode =
        typeof (err as any).statusCode === "number"
            ? (err as any).statusCode
            : 500;

    const message = err.message || "internal server error";

    res.status(statusCode).json({
        success: false,
        message,
    });
};

export default ehandler;
