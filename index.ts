import { hitlimit } from "@joint-ops/hitlimit";
import express, { Request, Response, NextFunction } from "express";
import signup from "./user/signup.ts";
import login from "./user/login.ts";
import middleware from "./utils/middleware.ts";
import market from "./market/market.ts";
import orderbook from "./market/orderbook.ts";

const app = express();

app.use(hitlimit({ limit: 10, window: "1m" }));

app.use(express.json());
app.get("/", (req: Request, res: Response, next: NextFunction) => {
    res.json({ msg: "health check" });
});
app.use("/signup", signup);
app.use("/login", login);
app.use(middleware);
app.use("/market", market);
app.use("/market", orderbook);

app.listen(process.env.PORT || 3000, () => {
    console.log(`listening on 3000!`);
});
