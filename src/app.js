import cors from "cors";
import { autenticarToken } from "./middlewares/autenticarToken.js";
import { exigirAdmin } from "./middlewares/validarProprietarioTrilha.js";
import { entregarFoto } from "./controllers/entregaFotoController.js";
import express from "express";
import trilhaRoutes from "./routes/trilhaRoutes.js";
import usuarioRoutes from "./routes/usuarioRoutes.js";
import {
  rotaNaoEncontrada,
  tratarErros,
} from "./middlewares/errorHandler.js";
import { origemFrontendPermitida } from "./config/origensFrontend.js";

const app = express();

app.use(
  cors({
    origin(origem, callback) {
      callback(null, origemFrontendPermitida(origem));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);
app.use(express.json());

app.get("/admin/trilhas/:id/fotos/:fotoId/conteudo", autenticarToken, exigirAdmin, entregarFoto("admin"));
app.use("/trilhas", trilhaRoutes);
app.use("/usuarios", usuarioRoutes);

app.use(rotaNaoEncontrada);
app.use(tratarErros);

export default app;
