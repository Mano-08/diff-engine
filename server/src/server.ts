import "dotenv/config";
import express from "express";
import cors from "cors";
import documentsRouter from "./routes/document";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/v1/documents", documentsRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`),
);
