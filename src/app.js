import cors from "cors";
import express from "express";
import trilhaRoutes from "./routes/trilhaRoutes.js";
import {
  rotaNaoEncontrada,
  tratarErros,
} from "./middlewares/errorHandler.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  }),
);
app.use(express.json());

app.use("/trilhas", trilhaRoutes);

app.use(rotaNaoEncontrada);
app.use(tratarErros);

export default app;
