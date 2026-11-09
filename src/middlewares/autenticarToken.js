import { jwtVerify } from "jose";
import mongoose from "mongoose";
import { ALGORITMO_JWT, obterChaveJwt } from "../config/jwt.js";
import Usuario from "../models/Usuario.js";

const MENSAGEM_TOKEN_INVALIDO = "Autenticação inválida ou expirada.";

function responderNaoAutenticado(res) {
  return res.status(401).json({ mensagem: MENSAGEM_TOKEN_INVALIDO });
}

export async function autenticarToken(req, res, next) {
  const autorizacao = req.get("authorization");
  const token = autorizacao?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

  if (!token) {
    return responderNaoAutenticado(res);
  }

  let payload;

  try {
    ({ payload } = await jwtVerify(token, obterChaveJwt(), {
      algorithms: [ALGORITMO_JWT],
    }));
  } catch {
    return responderNaoAutenticado(res);
  }

  if (
    typeof payload.sub !== "string" ||
    !mongoose.isValidObjectId(payload.sub) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return responderNaoAutenticado(res);
  }

  try {
    const usuario = await Usuario.findById(payload.sub).select(
      "_id nomeCompleto nomeUsuario email perfil",
    );

    if (!usuario) {
      return responderNaoAutenticado(res);
    }

    req.usuario = {
      _id: usuario._id,
      nomeCompleto: usuario.nomeCompleto,
      nomeUsuario: usuario.nomeUsuario,
      email: usuario.email,
      perfil: usuario.perfil,
    };

    return next();
  } catch (erro) {
    return next(erro);
  }
}
