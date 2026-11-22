import cors from "cors";
import { isIP } from "node:net";
import mongoose from "mongoose";
import { autenticarToken } from "./middlewares/autenticarToken.js";
import { exigirAdmin } from "./middlewares/validarProprietarioTrilha.js";
import { entregarFoto } from "./controllers/entregaFotoController.js";
import express from "express";
import trilhaRoutes from "./routes/trilhaRoutes.js";
import usuarioRoutes from "./routes/usuarioRoutes.js";
import administradorRoutes from "./routes/administradorRoutes.js";
import {
  rotaNaoEncontrada,
  tratarErros,
} from "./middlewares/errorHandler.js";
import { origemFrontendPermitida } from "./config/origensFrontend.js";

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_CIDRS) {
  const redes = process.env.TRUST_PROXY_CIDRS.split(",").map((rede) => rede.trim());
  if (redes.some((rede) => {
    const [ip, prefixo, extra] = rede.split("/");
    const familia = isIP(ip);
    return !familia || extra !== undefined || (prefixo !== undefined
      && (!/^\d{1,3}$/.test(prefixo) || Number(prefixo) < 1 || Number(prefixo) > (familia === 4 ? 32 : 128)));
  })) throw new Error("TRUST_PROXY_CIDRS deve conter endereços ou redes IP válidas de proxies confiáveis.");
  app.set("trust proxy", redes);
}

app.use(
  cors({
    origin(origem, callback) {
      callback(null, origemFrontendPermitida(origem));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    exposedHeaders: ["Retry-After"],
  }),
);
app.use("/admin/administradores", administradorRoutes);
app.use(express.json());

app.get("/healthz", (_req, res) => {
  const pronto = mongoose.connection.readyState === 1;
  res.set("Cache-Control", "no-store");
  res.status(pronto ? 200 : 503).json({ status: pronto ? "ok" : "unavailable" });
});
app.get("/admin/trilhas/:id/fotos/:fotoId/conteudo", autenticarToken, exigirAdmin, entregarFoto("admin"));
app.use("/trilhas", trilhaRoutes);
app.use("/usuarios", usuarioRoutes);

app.use(rotaNaoEncontrada);
app.use(tratarErros);

export default app;
