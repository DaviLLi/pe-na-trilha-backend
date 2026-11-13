import mongoose from "mongoose";
import Usuario from "../models/Usuario.js";

export class ErroProvisionamento extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo; }
}

// Uso exclusivamente operacional por CLI. Não importar em rotas HTTP.
export async function provisionarPrimeiroAdmin({ email, confirmado }, dependencias) {
  if (confirmado !== true) throw new ErroProvisionamento("CONFIRMACAO_OBRIGATORIA");
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ErroProvisionamento("ALVO_INVALIDO");
  }
  const normalizado = email.trim().normalize("NFC").toLowerCase().normalize("NFC");
  const { usuarios, controle, iniciarSessao } = dependencias || {
    usuarios: Usuario,
    controle: mongoose.connection.collection("provisionamentoAdministrativo"),
    iniciarSessao: () => mongoose.startSession(),
  };
  const sessao = await iniciarSessao();
  try {
    await sessao.withTransaction(async () => {
      // Não presume que o índice único já exista em uma base legada.
      // Só lê identidade/papel; nunca senha ou demais dados da conta.
      const contas = await usuarios.find({ email: normalizado })
        .select("_id perfil").limit(2).session(sessao);
      if (!contas.length) throw new ErroProvisionamento("ALVO_NAO_ENCONTRADO");
      if (contas.length !== 1) throw new ErroProvisionamento("EMAIL_AMBIGUO");
      const usuarioId = contas[0]._id;
      // _id único serializa tentativas concorrentes. O marcador e a promoção
      // são confirmados juntos; qualquer falha desfaz os dois.
      await controle.insertOne({ _id: "primeiro-admin", usuario: new mongoose.Types.ObjectId(usuarioId), criadoEm: new Date() }, { session: sessao });
      if (await usuarios.exists({ perfil: "admin" }).session(sessao)) {
        throw new ErroProvisionamento("ADMIN_JA_EXISTE");
      }
      const usuario = await usuarios.findOneAndUpdate(
        { _id: usuarioId, email: normalizado, perfil: "user" },
        { $set: { perfil: "admin" } },
        { session: sessao, returnDocument: "after", runValidators: true },
      );
      if (!usuario) throw new ErroProvisionamento("ALVO_NAO_ENCONTRADO");
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } catch (erro) {
    if (erro?.code === 11000) throw new ErroProvisionamento("PROVISIONAMENTO_ENCERRADO");
    throw erro;
  } finally { await sessao.endSession(); }
}
