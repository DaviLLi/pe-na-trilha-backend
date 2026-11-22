import bcrypt from "bcrypt";
import mongoose from "mongoose";
import Usuario from "../models/Usuario.js";

import { ErroGerenciamentoAdmin } from "./errosGerenciamentoAdmin.js";
import { reservarTentativaAdmin } from "./limitarConfirmacaoAdmin.js";
const mudancas = {
  promover: { de: "user", para: "admin", erroPerfil: "JA_ADMIN" },
  remover: { de: "admin", para: "user", erroPerfil: "NAO_ADMIN" },
};

function colecaoControle() {
  return mongoose.connection.collection("provisionamentoAdministrativo");
}

async function lerPrincipal(controle, sessao) {
  const marcador = await controle.findOne(
    { _id: "primeiro-admin" },
    { session: sessao, projection: { usuario: 1 } },
  );
  if (!(marcador?.usuario instanceof mongoose.Types.ObjectId)) {
    throw new ErroGerenciamentoAdmin("MARCADOR_INDISPONIVEL");
  }
  return marcador.usuario;
}

export async function conferirAdminPrincipal(usuario) {
  if (usuario?.perfil !== "admin" || !mongoose.isObjectIdOrHexString(usuario._id)) {
    throw new ErroGerenciamentoAdmin("ACESSO_PRINCIPAL");
  }
  const principalId = await lerPrincipal(colecaoControle());
  if (!principalId.equals(usuario._id)) throw new ErroGerenciamentoAdmin("ACESSO_PRINCIPAL");
}

export async function listarAdministradores(principalId) {
  const contas = await Usuario.find({ perfil: "admin" }).select("_id nomeCompleto email perfil")
    .sort({ email: 1, _id: 1 }).lean();
  return contas.filter(({ perfil }) => perfil === "admin").map(({ _id, nomeCompleto, email }) => ({
    _id, nomeCompleto, email, principal: _id.equals(principalId),
  }));
}

function obterMudanca(acao) {
  if (!Object.hasOwn(mudancas, acao)) throw new ErroGerenciamentoAdmin("ENTRADA");
  return mudancas[acao];
}

export function normalizarEmailAdmin(email) {
  // A confirmação exibe o e-mail no terminal. Recuse caracteres de controle e formatação.
  if (typeof email !== "string" || /[\p{Cc}\p{Cf}]/u.test(email)) {
    throw new ErroGerenciamentoAdmin("EMAIL_INVALIDO");
  }
  const normalizado = email.trim().normalize("NFC").toLowerCase().normalize("NFC");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizado)) {
    throw new ErroGerenciamentoAdmin("EMAIL_INVALIDO");
  }
  return normalizado;
}

export async function localizarContaAdmin({ acao, email }, { usuarios = Usuario, sessao } = {}) {
  const mudanca = obterMudanca(acao);
  const normalizado = normalizarEmailAdmin(email);
  const consulta = usuarios.find({ email: normalizado })
    .select("_id email perfil").limit(2).lean();
  if (sessao) consulta.session(sessao);
  const contas = await consulta;
  if (!contas.length) throw new ErroGerenciamentoAdmin("CONTA_INEXISTENTE");
  if (contas.length !== 1) throw new ErroGerenciamentoAdmin("EMAIL_AMBIGUO");
  const [conta] = contas;
  if (conta.email !== normalizado) throw new ErroGerenciamentoAdmin("CONTA_INEXISTENTE");
  if (conta.perfil !== mudanca.de) throw new ErroGerenciamentoAdmin(mudanca.erroPerfil);
  return conta;
}

async function lerCredencialPrincipal(usuarios, principalId, sessao) {
  const consulta = usuarios.findById(principalId).select("_id email perfil +senha").lean();
  if (sessao) consulta.session(sessao);
  const principal = await consulta;
  if (principal?.perfil !== "admin" || typeof principal.senha !== "string" || !principal.senha) {
    throw new ErroGerenciamentoAdmin("ADMIN_ORIGINAL_INATIVO");
  }
  return principal;
}

export async function alterarPerfilAdmin({
  acao, email, usuarioId, confirmado, operadorId, operadorEmail, senha,
}, dependencias) {
  if (confirmado !== true) throw new ErroGerenciamentoAdmin("CONFIRMACAO");
  const { de, para } = obterMudanca(acao);
  const emailConfirmado = normalizarEmailAdmin(email);
  if (usuarioId !== undefined && !mongoose.isObjectIdOrHexString(usuarioId)) {
    throw new ErroGerenciamentoAdmin("CONTA_ALTERADA");
  }
  if (typeof senha !== "string" || !senha || Buffer.byteLength(senha, "utf8") > 72) {
    throw new ErroGerenciamentoAdmin("SENHA_INVALIDA");
  }

  const { usuarios, controle, auditoria, tentativas, iniciarSessao } = dependencias ?? {
    usuarios: Usuario,
    controle: colecaoControle(),
    auditoria: mongoose.connection.collection("auditoriaAdministrativa"),
    tentativas: mongoose.connection.collection("confirmacoesAdministrativas"),
    iniciarSessao: () => mongoose.startSession(),
  };
  const principalId = await lerPrincipal(controle);
  const viaTerminal = operadorId === undefined && typeof operadorEmail === "string";
  if (!viaTerminal && (!mongoose.isObjectIdOrHexString(operadorId) || !principalId.equals(operadorId))) {
    throw new ErroGerenciamentoAdmin("ACESSO_PRINCIPAL");
  }
  const principal = await lerCredencialPrincipal(usuarios, principalId);
  if (viaTerminal && principal.email !== normalizarEmailAdmin(operadorEmail)) {
    throw new ErroGerenciamentoAdmin("IDENTIDADE_NAO_CONFIRMADA");
  }
  await reservarTentativaAdmin(tentativas, principalId);
  if (!(await bcrypt.compare(senha, principal.senha))) {
    throw new ErroGerenciamentoAdmin("IDENTIDADE_NAO_CONFIRMADA");
  }

  const sessao = await iniciarSessao();
  try {
    await sessao.withTransaction(async () => {
      const idAtual = await lerPrincipal(controle, sessao);
      if (!idAtual.equals(principalId)) throw new ErroGerenciamentoAdmin("ACESSO_PRINCIPAL");
      const original = await lerCredencialPrincipal(usuarios, idAtual, sessao);
      if (original.senha !== principal.senha || (viaTerminal && original.email !== principal.email)) {
        throw new ErroGerenciamentoAdmin("IDENTIDADE_NAO_CONFIRMADA");
      }

      const conta = await localizarContaAdmin({ acao, email: emailConfirmado }, { usuarios, sessao });
      if (usuarioId !== undefined && !conta._id.equals(usuarioId)) {
        throw new ErroGerenciamentoAdmin("CONTA_ALTERADA");
      }
      // A conta protegida permanece ativa inclusive após remoções concorrentes.
      if (idAtual.equals(conta._id)) throw new ErroGerenciamentoAdmin("ADMIN_ORIGINAL");

      const resultado = await usuarios.updateOne(
        { _id: conta._id, email: emailConfirmado, perfil: de },
        { $set: { perfil: para } },
        { session: sessao, timestamps: false, runValidators: true },
      );
      if (resultado.modifiedCount !== 1) throw new ErroGerenciamentoAdmin("CONTA_ALTERADA");
      await auditoria.insertOne(
        { ator: principalId, alvo: conta._id, acao, criadoEm: new Date() },
        { session: sessao },
      );
    }, { readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await sessao.endSession();
  }
}
