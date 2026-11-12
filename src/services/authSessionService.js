import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { SignJWT } from "jose";
import {
  DURACAO_SESSAO_MS,
} from "../config/authCookies.js";
import {
  ALGORITMO_JWT,
  obterChaveJwt,
} from "../config/jwt.js";
import AuthSession from "../models/AuthSession.js";
import RefreshToken from "../models/RefreshToken.js";
import Usuario from "../models/Usuario.js";

const JANELA_REFRESH_CONCORRENTE_MS = 5_000;

function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function criarAccessToken(usuarioId, sessionId) {
  return new SignJWT({ sid: sessionId.toString() })
    .setProtectedHeader({ alg: ALGORITMO_JWT, typ: "JWT" })
    .setSubject(usuarioId.toString())
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(obterChaveJwt());
}

export async function criarSessaoAuth(usuario) {
  const sessionId = new mongoose.Types.ObjectId();
  const refreshToken = randomBytes(32).toString("base64url");
  const tokenHash = hashRefreshToken(refreshToken);
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + DURACAO_SESSAO_MS);
  const mongoSession = await mongoose.startSession();

  try {
    await mongoSession.withTransaction(async () => {
      await AuthSession.create(
        [{ _id: sessionId, user: usuario._id, expiresAt: expiraEm }],
        { session: mongoSession },
      );
      await RefreshToken.create(
        [{ session: sessionId, tokenHash, expiresAt: expiraEm }],
        { session: mongoSession },
      );
    });
  } finally {
    await mongoSession.endSession();
  }

  const accessToken = await criarAccessToken(usuario._id, sessionId);
  return { accessToken, refreshToken, sessionId, expiraEm };
}

async function revogarDentroDaTransacao(sessionId, agora, mongoSession) {
  await AuthSession.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: agora } },
    { session: mongoSession },
  );
  await RefreshToken.updateMany(
    { session: sessionId, revokedAt: null },
    { $set: { revokedAt: agora } },
    { session: mongoSession },
  );
}

export async function rotacionarRefreshToken(refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) return null;

  const tokenHash = hashRefreshToken(refreshToken);
  const novoRefreshToken = randomBytes(32).toString("base64url");
  const novoHash = hashRefreshToken(novoRefreshToken);
  const requisicaoIniciadaEm = Date.now();
  const agora = new Date();
  const mongoSession = await mongoose.startSession();
  let resultado = null;

  try {
    await mongoSession.withTransaction(async () => {
      resultado = null;
      const registro = await RefreshToken.findOne({ tokenHash })
        .select("+tokenHash +replacedByHash")
        .session(mongoSession);

      if (!registro) return;

      const sessao = await AuthSession.findById(registro.session).session(mongoSession);
      if (
        !sessao ||
        sessao.revokedAt ||
        sessao.expiresAt.getTime() <= agora.getTime()
      ) {
        return;
      }

      if (registro.consumedAt) {
        const diferencaMs = Math.abs(
          registro.consumedAt.getTime() - requisicaoIniciadaEm,
        );

        if (diferencaMs <= JANELA_REFRESH_CONCORRENTE_MS) {
          resultado = { concorrente: true };
          return;
        }

        await revogarDentroDaTransacao(sessao._id, agora, mongoSession);
        resultado = { reutilizado: true };
        return;
      }

      if (registro.revokedAt) {
        await revogarDentroDaTransacao(sessao._id, agora, mongoSession);
        resultado = { reutilizado: true };
        return;
      }

      const consumido = await RefreshToken.findOneAndUpdate(
        {
          _id: registro._id,
          consumedAt: null,
          revokedAt: null,
        },
        { $set: { consumedAt: agora, replacedByHash: novoHash } },
        { session: mongoSession },
      );

      if (!consumido) {
        resultado = { concorrente: true };
        return;
      }

      const usuario = await Usuario.findById(sessao.user).session(mongoSession);
      if (!usuario) {
        await revogarDentroDaTransacao(sessao._id, agora, mongoSession);
        return;
      }

      await RefreshToken.create(
        [{ session: sessao._id, tokenHash: novoHash, expiresAt: sessao.expiresAt }],
        { session: mongoSession },
      );

      resultado = { sessao, usuario };
    });
  } finally {
    await mongoSession.endSession();
  }

  if (resultado?.concorrente) return { concorrente: true };
  if (resultado?.reutilizado) return { reutilizado: true };
  if (!resultado?.sessao) return null;

  const accessToken = await criarAccessToken(
    resultado.usuario._id,
    resultado.sessao._id,
  );

  return {
    accessToken,
    refreshToken: novoRefreshToken,
    sessionId: resultado.sessao._id,
    usuario: resultado.usuario,
    expiraEm: resultado.sessao.expiresAt,
  };
}

export async function revogarSessao(sessionId) {
  const mongoSession = await mongoose.startSession();
  try {
    await mongoSession.withTransaction(async () => {
      await revogarDentroDaTransacao(sessionId, new Date(), mongoSession);
    });
  } finally {
    await mongoSession.endSession();
  }
}

