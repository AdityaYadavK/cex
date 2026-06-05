import express, { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/error.ts";
import { prisma } from "../utils/db.ts";
import middleware from "../utils/middleware.ts";

// in-memory order book
// { pair : { bids : order[], asks : order[] }}

const book: Record<string, { bids: any[]; asks: any[] }> = {};

function getBook(pair: string) {
    if (book[pair]) {
        book[pair] = { bids: [], asks: [] };
    }
    return book[pair];
}

export async function match(incoming : any) {
    
}
