import { jwtVerify } from "jose";
import mongoose from "mongoose";
import { ALGORITMO_JWT, obterChaveJwt } from "../config/jwt.js";
import {
  lerCookie,
  limparCookieAccess,
  nomeCookieAccess,
} from "../config/authCookies.js";
import AuthSession from "../models/AuthSession.js";
import Usuario from "../models/Usuario.js";

const MENSAGEM_TOKEN_INVALIDO = "Autenticação inválida ou expirada.";

function responderNaoAutenticado(res, temCookie = false) {
  if (temCookie) limparCookieAccess(res);
  return res.status(401).json({ mensagem: MENSAGEM_TOKEN_INVALIDO });
}

export async function autenticarToken(req, res, next) {
  const autorizacao = req.get("authorization");
  const tokenCookie = lerCookie(req, nomeCookieAccess());
  const tokenBearer = autorizacao?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  const token = tokenCookie || tokenBearer;

  if (!token) {
    return responderNaoAutenticado(res, Boolean(tokenCookie));
  }

  let payload;

  try {
    ({ payload } = await jwtVerify(token, obterChaveJwt(), {
      algorithms: [ALGORITMO_JWT],
    }));
  } catch {
    return responderNaoAutenticado(res, Boolean(tokenCookie));
  }

  if (
    typeof payload.sub !== "string" ||
    !mongoose.isValidObjectId(payload.sub) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return responderNaoAutenticado(res, Boolean(tokenCookie));
  }

  let authSession = null;
  if (payload.sid !== undefined) {
    if (typeof payload.sid !== "string" || !mongoose.isValidObjectId(payload.sid)) {
      return responderNaoAutenticado(res, Boolean(tokenCookie));
    }

    try {
      authSession = await AuthSession.findOne({
        _id: payload.sid,
        user: payload.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
    } catch (erro) {
      return next(erro);
    }

    if (!authSession) {
      return responderNaoAutenticado(res, Boolean(tokenCookie));
    }
  } else if (tokenCookie) {
    return responderNaoAutenticado(res, true);
  }

  try {
    const usuario = await Usuario.findById(payload.sub).select(
      "_id nomeCompleto nomeUsuario email perfil",
    );

    if (!usuario) {
      return responderNaoAutenticado(res, Boolean(tokenCookie));
    }

    req.usuario = {
      _id: usuario._id,
      nomeCompleto: usuario.nomeCompleto,
      nomeUsuario: usuario.nomeUsuario,
      email: usuario.email,
      perfil: usuario.perfil,
    };
    req.authMethod = tokenCookie ? "cookie" : "bearer";
    req.authSession = authSession;

    return next();
  } catch (erro) {
    return next(erro);
  }
}
