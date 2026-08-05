// import "dotenv/config";
// import express from "express";
// import cors from "cors";

// const app = express();
// app.use(cors());
// app.use(express.json());

// app.use("/api/v1/documents", documentsRouter);
// app.use("/api/v1/ai", aiRouter);

// const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
// app.listen(PORT, () =>
//   console.log(`Backend running on http://localhost:${PORT}`),
// );

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import documentsRouter from "./routes/document";
import aiRouter from "./routes/ai";

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
