import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import documentsRouter from "./routes/document.js";
import aiRouter from "./routes/ai.js";

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
); // credentials required for cookies cross-origin
app.use(cookieParser());
app.use(express.json());

const STORAGE_DIR = path.resolve("storage");
fs.mkdirSync(path.join(STORAGE_DIR, "videos"), { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, "screenshots"), { recursive: true });
app.use("/files", express.static(STORAGE_DIR));

app.use("/api/v1/ai", requireAuth, aiRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/documents", requireAuth, documentsRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`),
);

app.get("/", (_, res) => {
  res.sendStatus(200);
});

const PING_INTERVAL = 13 * 60 * 1000; // 13 minutes in ms

async function selfPing(): Promise<void> {
  try {
    const pingUrl = process.env.BACKEND_URL || `http://localhost:${PORT}/`;
    const res = await fetch(pingUrl);
    console.log(`Self-ping successful: ${res.status}`);
  } catch (error) {
    console.error("Self-ping failed:", error);
  } finally {
    setTimeout(selfPing, PING_INTERVAL);
  }
}

setTimeout(selfPing, PING_INTERVAL);
