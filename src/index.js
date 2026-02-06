import express from "express";
import cors from "cors";
import tokenLaunchRouter from "./routes/tokenLaunch.js";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();

// CORS middleware
app.use(
  cors({
    origin: "*", // 生产环境建议限制为具体域名
    credentials: true,
  })
);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use(tokenLaunchRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});

