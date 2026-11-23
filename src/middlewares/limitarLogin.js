import { createHmac } from "node:crypto";
import { isIP, SocketAddress } from "node:net";
import { obterSegredoCsrf } from "../config/csrf.js";
import TentativaLogin from "../models/TentativaLogin.js";

const JANELA_MS = 5 * 60_000;
const LIMITE_IP = 60;
const LIMITE_IDENTIFICADOR = 10;

function redeCliente(ip) {
  if (isIP(ip) === 4) return ip;
  const endereco = new SocketAddress({ address: ip, family: "ipv6" }).address;
  if (endereco.startsWith("::ffff:")) return endereco.slice(7);
  const [inicio, fim] = endereco.split("::");
  const esquerda = inicio ? inicio.split(":") : [];
  const direita = fim ? fim.split(":") : [];
  const preenchimento = Array(8 - esquerda.length - direita.length).fill("0");
  return [...esquerda, ...preenchimento, ...direita].slice(0, 4).join(":");
}

async function reservar(dimensao, valor, limite) {
  const _id = createHmac("sha256", obterSegredoCsrf())
    .update(`login:${dimensao}:${valor}`).digest("hex");
  const expirou = { $lte: [{ $ifNull: ["$expiraEm", new Date(0)] }, "$$NOW"] };
  const atualizacao = [{ $set: {
    expiraEm: { $cond: [expirou, { $add: ["$$NOW", JANELA_MS] }, "$expiraEm"] },
    tentativas: { $cond: [expirou, 1, { $min: [{ $add: ["$tentativas", 1] }, limite + 2] }] },
  } }];
  const opcoes = { returnDocument: "after", maxTimeMS: 2000 };
  let reserva;
  try {
    reserva = await TentativaLogin.collection.findOneAndUpdate({ _id }, atualizacao, { ...opcoes, upsert: true });
  } catch (erro) {
    if (erro?.code !== 11000) throw erro;
    reserva = await TentativaLogin.collection.findOneAndUpdate({ _id }, atualizacao, opcoes);
  }
  if (!Number.isInteger(reserva?.tentativas) || reserva.tentativas < 1 || !(reserva.expiraEm instanceof Date)) {
    throw new Error("Reserva de login indisponível.");
  }
  if (reserva.tentativas === limite + 1) {
    console.warn("Limite de tentativas de login atingido.", { dimensao });
  }
  return reserva.tentativas > limite ? reserva.expiraEm : null;
}

export async function limitarLogin(req, res, next) {
  try {
    // Limita a origem antes de criar chaves para identificadores arbitrários.
    const expiraEm = await reservar("origem", redeCliente(req.ip), LIMITE_IP)
      || await reservar("identificador", req.body.identificador, LIMITE_IDENTIFICADOR);
    if (expiraEm) {
      const espera = Math.max(1, Math.min(JANELA_MS / 1000, Math.ceil((expiraEm - Date.now()) / 1000)));
      res.set("Retry-After", String(espera));
      return res.status(429).json({ mensagem: "Muitas tentativas de login. Tente novamente mais tarde." });
    }
  } catch {
    console.error("Limitador de login indisponível.");
    return res.status(503).json({ mensagem: "Autenticação temporariamente indisponível." });
  }
  return next();
}
