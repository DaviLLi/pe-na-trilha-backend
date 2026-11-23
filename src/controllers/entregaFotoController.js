import mongoose from "mongoose";
import Trilha from "../models/Trilha.js";
import { fotoProtegida } from "../domain/fotoPublicacao.js";
import { abrirFotoProtegida, transmitirFoto, esperarComCancelamento, VARIANTES } from "../services/entregaFotoService.js";

const MAX_ENTREGAS_SIMULTANEAS = 20;
const TEMPO_MAX_ENTREGA_MS = 30_000;
let entregasAtivas = 0;

export function entregarFoto(contexto) {
  return async (req, res, next) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      Vary: "Origin, Cookie, Authorization",
    });
    if (res.destroyed || req.aborted) return;
    if (entregasAtivas >= MAX_ENTREGAS_SIMULTANEAS) {
      res.set("Retry-After", "2");
      return res.status(503).json({ mensagem: "Serviço de imagens ocupado." });
    }
    entregasAtivas++;
    const cancelamento = new AbortController();
    const { signal } = cancelamento;
    const inicio = Date.now();
    let expirou = false;
    let origem;
    let consultandoBanco = false;
    const desconectou = () => { if (!res.writableFinished) cancelamento.abort(); };
    res.once("close", desconectou);
    req.once?.("aborted", desconectou);
    const timer = setTimeout(() => { expirou = true; cancelamento.abort(); }, TEMPO_MAX_ENTREGA_MS);
    timer.unref?.();
    try {
      if (res.destroyed || req.aborted) return;
      const { id, fotoId } = req.params;
      const variante = Object.hasOwn(req.query, "variante") ? req.query.variante : "detalhe";
      if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(fotoId)) {
        return res.status(400).json({ mensagem: "ID de publicação ou foto inválido." });
      }
      if (Object.keys(req.query).some((chave) => chave !== "variante") || typeof variante !== "string" || !Object.hasOwn(VARIANTES, variante)) {
        return res.status(400).json({ mensagem: "Variante de imagem inválida." });
      }
      const filtro = { _id: id, "fotos._id": fotoId };
      if (contexto === "publico") filtro.status = "approved";
      else {
        filtro.status = { $in: ["pending", "rejected", "approved"] };
        if (contexto === "autor") filtro.proprietario = req.usuario._id;
      }
      signal.throwIfAborted();
      consultandoBanco = true;
      const restante = Math.max(1, TEMPO_MAX_ENTREGA_MS - (Date.now() - inicio));
      const trilha = await esperarComCancelamento(
        () => Trilha.findOne(filtro, null, { signal, maxTimeMS: restante, timeoutMS: restante }), signal,
      );
      signal.throwIfAborted();
      consultandoBanco = false;
      const foto = trilha?.fotos?.find((item) => String(item._id) === fotoId);
      if (!foto || !fotoProtegida(foto)) return res.status(404).json({ mensagem: "Foto não encontrada." });
      if (req.method === "HEAD") return res.type("image/webp").end();
      signal.throwIfAborted();
      origem = await abrirFotoProtegida(foto, variante, signal);
      signal.throwIfAborted();
      res.type("image/webp");
      // Não encaminha headers ou redirects do provedor.
      await transmitirFoto(origem, res, signal);
    } catch (erro) {
      if (consultandoBanco && (erro.code === 50 || erro.name === "MongoOperationTimeoutError")) {
        expirou = true;
        cancelamento.abort();
      }
      origem?.destroy();
      if (res.destroyed || req.aborted || (signal.aborted && !expirou)) return;
      if (consultandoBanco && !expirou && !signal.aborted) return next(erro);
      if (res.headersSent) return res.destroy();
      res.removeHeader("Content-Type");
      const status = expirou ? 504 : erro.status === 503 ? 503 : 502;
      return res.status(status).json({ mensagem: "Não foi possível entregar a imagem." });
    } finally {
      clearTimeout(timer);
      res.off("close", desconectou);
      req.off?.("aborted", desconectou);
      entregasAtivas--;
    }
  };
}
