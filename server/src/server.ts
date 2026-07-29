import "dotenv/config";
import express from "express";
import cors from "cors";
import documentsRouter from "./routes/document";
import aiRouter from "./routes/ai";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/v1/documents", documentsRouter);
app.use("/api/v1/ai", aiRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`),
);
