import bcrypt from "bcrypt";
import { SignJWT } from "jose";
import {
  ALGORITMO_JWT,
  obterChaveJwt,
  TEMPO_EXPIRACAO_JWT,
} from "../config/jwt.js";
import Usuario from "../models/Usuario.js";

const MENSAGEM_CREDENCIAIS_INVALIDAS = "Credenciais inválidas.";
const ROUNDS_COMPARACAO_FALHA = 12;

function dadosPublicosUsuario(usuario) {
  return {
    _id: usuario._id,
    nomeCompleto: usuario.nomeCompleto,
    nomeUsuario: usuario.nomeUsuario,
    email: usuario.email,
    perfil: usuario.perfil,
    fotoPerfil: usuario.fotoPerfil,
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt,
  };
}

export async function cadastrarUsuario(req, res, next) {
  try {
    const usuario = await Usuario.create(req.body);

    return res.status(201).json(dadosPublicosUsuario(usuario));
  } catch (erro) {
    return next(erro);
  }
}

export async function loginUsuario(req, res, next) {
  try {
    const { identificador, senha } = req.body;
    const campo = identificador.includes("@") ? "email" : "nomeUsuario";
    const usuario = await Usuario.findOne({ [campo]: identificador }).select(
      "+senha",
    );

    if (!usuario) {
      await bcrypt.hash(senha, ROUNDS_COMPARACAO_FALHA);
      return res.status(401).json({
        mensagem: MENSAGEM_CREDENCIAIS_INVALIDAS,
      });
    }

    if (!(await bcrypt.compare(senha, usuario.senha))) {
      return res.status(401).json({
        mensagem: MENSAGEM_CREDENCIAIS_INVALIDAS,
      });
    }

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: ALGORITMO_JWT, typ: "JWT" })
      .setSubject(usuario._id.toString())
      .setIssuedAt()
      .setExpirationTime(TEMPO_EXPIRACAO_JWT)
      .sign(obterChaveJwt());

    return res.status(200).json({
      token,
      usuario: dadosPublicosUsuario(usuario),
    });
  } catch (erro) {
    return next(erro);
  }
}

export async function buscarUsuarioAtual(req, res, next) {
  try {
    const usuario = await Usuario.findById(req.usuario._id).select(
      "_id nomeCompleto nomeUsuario email perfil fotoPerfil createdAt updatedAt",
    );

    if (!usuario) {
      return res.status(404).json({ mensagem: "Usuário não encontrado." });
    }

    return res.status(200).json(dadosPublicosUsuario(usuario));
  } catch (erro) {
    return next(erro);
  }
}

export async function atualizarUsuarioAtual(req, res, next) {
  try {
    const usuario = await Usuario.findById(req.usuario._id);

    if (!usuario) {
      return res.status(404).json({ mensagem: "Usuário não encontrado." });
    }

    Object.assign(usuario, req.body);
    await usuario.save();

    return res.status(200).json(dadosPublicosUsuario(usuario));
  } catch (erro) {
    return next(erro);
  }
}
