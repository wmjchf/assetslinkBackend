import Koa from "koa";
import cors from "@koa/cors";
import bodyParser from "koa-bodyparser";
import tokenLaunchRouter from "./routes/tokenLaunch";
import * as dotenv from "dotenv";

dotenv.config();

const app = new Koa();

// CORS middleware
app.use(
  cors({
    origin: "*", // 生产环境建议限制为具体域名
    credentials: true,
  })
);

// Body parser middleware
app.use(bodyParser());

// Routes
app.use(tokenLaunchRouter.routes()).use(tokenLaunchRouter.allowedMethods());

// Health check
app.use(async (ctx, next) => {
  if (ctx.path === "/health") {
    ctx.body = { status: "ok" };
    return;
  }
  await next();
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});

