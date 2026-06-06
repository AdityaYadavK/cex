import { hitlimit } from "@joint-ops/hitlimit";
import express, { Request, Response, NextFunction } from "express";
import signup from "./user/signup.ts";
import login from "./user/login.ts";
import middleware from "./utils/middleware.ts";
import market from "./market/market.ts";
import orderbook from "./market/orderbook.ts";
import place from "./order/place.ts";
import list from "./order/list.ts";
import cancel from "./order/cancel.ts";
import balance from "./wallet/balance.ts";
import deposit from "./wallet/deposit.ts";
import cp from "cookie-parser";
import ehandler from "./utils/ehandler.ts";
import tlist from "./trades/list.ts";

const app = express();

app.use(hitlimit({ limit: 10, window: "1m" }));
app.use(cp());

app.use(express.json());
app.get("/", (req: Request, res: Response, next: NextFunction) => {
    res.json({ msg: "health check" });
});
app.use("/signup", signup);
app.use("/login", login);
app.use("/market", market);
app.use("/market", orderbook);
app.use("/wallet/balance", balance);
app.use("/wallet/deposit", deposit);
app.use("/order/place", place);
app.use("/order/list", list);
app.use("/order/cancel", cancel);
app.use("/trade/list", tlist);

app.use(ehandler);

app.listen(process.env.PORT || 3000, () => {
    console.log(`listening on 3000!`);
});
