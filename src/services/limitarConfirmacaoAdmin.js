import { ErroGerenciamentoAdmin } from "./errosGerenciamentoAdmin.js";

const limite = 5;
const janelaMs = 15 * 60_000;

export async function reservarTentativaAdmin(colecao, principalId) {
  // O relógio do MongoDB e a escrita atômica valem para HTTP, CLI e todas as instâncias.
  const expirou = { $lte: [{ $ifNull: ["$expiraEm", new Date(0)] }, "$$NOW"] };
  const atualizacao = [{ $set: {
    expiraEm: { $cond: [expirou, { $add: ["$$NOW", janelaMs] }, "$expiraEm"] },
    tentativas: { $cond: [expirou, 1, { $min: [{ $add: ["$tentativas", 1] }, limite + 1] }] },
  } }];
  const filtro = { _id: principalId };
  const opcoes = { returnDocument: "after", writeConcern: { w: "majority" } };
  let reserva;
  try {
    reserva = await colecao.findOneAndUpdate(filtro, atualizacao, { ...opcoes, upsert: true });
  } catch (erro) {
    if (erro?.code !== 11000) throw erro;
    // Outra conexão criou a primeira janela ao mesmo tempo.
    reserva = await colecao.findOneAndUpdate(filtro, atualizacao, opcoes);
  }
  if (!Number.isInteger(reserva?.tentativas) || reserva.tentativas < 1) {
    throw new ErroGerenciamentoAdmin("LIMITE_INDISPONIVEL");
  }
  if (reserva.tentativas > limite) throw new ErroGerenciamentoAdmin("LIMITE_TENTATIVAS");
}
