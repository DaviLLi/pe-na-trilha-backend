import { randomUUID } from "node:crypto";
import OperacaoImagem from "../models/OperacaoImagem.js";
import { cloudinaryDisponivel } from "../config/cloudinary.js";
import { excluirImagem } from "./cloudinaryService.js";

const LEASE_PROCESSAMENTO_MS = 3 * 60 * 1000;
const CARÊNCIA_UPLOAD_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 8;
const INTERVALO_MS = 15000;
let timer;
let executando = false;
let cicloAtivo;
let encerrando = false;
let encerramentoAtivo;

function atrasoTentativa(tentativas) {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(tentativas, 12));
}

export async function recuperarOperacoesExpiradas(agora = new Date()) {
  await OperacaoImagem.updateMany(
    { estado: "uploading", uploadLeaseUntil: { $lte: agora } },
    {
      $set: {
        estado: "cleanup_pending",
        nextAttemptAt: new Date(agora.getTime() + CARÊNCIA_UPLOAD_MS),
        uploadLeaseToken: null,
        uploadLeaseUntil: null,
        ultimoErro: "Lease de upload expirou antes da confirmação.",
      },
      $push: {
        historicoTentativas: {
          $each: [{ data: agora, erro: "Lease de upload expirou antes da confirmação." }],
          $slice: -20,
        },
      },
    },
  );

  await OperacaoImagem.updateMany(
    { estado: "processing", processingLeaseUntil: { $lte: agora } },
    {
      $set: {
        estado: "cleanup_pending",
        nextAttemptAt: agora,
        processingLeaseToken: null,
        processingLeaseUntil: null,
        ultimoErro: "Lease de processamento expirou; operação será repetida.",
      },
      $push: {
        historicoTentativas: {
          $each: [{
            data: agora,
            erro: "Lease de processamento expirou; operação será repetida.",
          }],
          $slice: -20,
        },
      },
    },
  );
}

export async function processarUmaOperacao(agora = new Date()) {
  if (!cloudinaryDisponivel()) {
    return false;
  }

  const token = randomUUID();
  const operacao = await OperacaoImagem.findOneAndUpdate(
    {
      estado: "cleanup_pending",
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: agora } }],
    },
    {
      $set: {
        estado: "processing",
        processingLeaseToken: token,
        processingLeaseUntil: new Date(agora.getTime() + LEASE_PROCESSAMENTO_MS),
      },
      $inc: { tentativas: 1 },
      $push: {
        historicoTentativas: {
          $each: [{ data: agora, erro: "Tentativa de exclusão iniciada." }],
          $slice: -20,
        },
      },
    },
    { returnDocument: "after" },
  );

  if (!operacao) {
    return false;
  }

  try {
    await excluirImagem(operacao.publicId);
    await OperacaoImagem.updateOne(
      { _id: operacao._id, estado: "processing", processingLeaseToken: token },
      {
        $set: { estado: "completed", concluidoEm: new Date(), ultimoErro: null },
        $unset: { processingLeaseToken: 1, processingLeaseUntil: 1 },
      },
    );
  } catch {
    const encerrada = operacao.tentativas >= MAX_TENTATIVAS;
    const ocorridoEm = new Date();
    const mensagem = "Falha ao excluir imagem no serviço remoto.";
    await OperacaoImagem.updateOne(
      { _id: operacao._id, estado: "processing", processingLeaseToken: token },
      {
        $set: {
          estado: encerrada ? "failed" : "cleanup_pending",
          nextAttemptAt: encerrada
            ? null
            : new Date(ocorridoEm.getTime() + atrasoTentativa(operacao.tentativas)),
          ultimoErro: mensagem,
        },
        $push: {
          historicoTentativas: {
            $each: [{ data: ocorridoEm, erro: mensagem }],
            $slice: -20,
          },
        },
        $unset: { processingLeaseToken: 1, processingLeaseUntil: 1 },
      },
    );
  }

  return true;
}

export async function reenfileirarOperacaoImagem(id) {
  return OperacaoImagem.findOneAndUpdate(
    { _id: id, estado: "failed" },
    {
      $set: {
        estado: "cleanup_pending",
        nextAttemptAt: new Date(),
        tentativas: 0,
        ultimoErro: null,
      },
    },
    { returnDocument: "after" },
  );
}

function ciclo() {
  if (encerrando || executando) {
    return cicloAtivo;
  }

  executando = true;
  cicloAtivo = (async () => {
    try {
      if (cloudinaryDisponivel()) {
        await recuperarOperacoesExpiradas();
        await processarUmaOperacao();
      }
    } catch (erro) {
      console.error("Falha no processador de operações de imagem:", erro.message);
    } finally {
      executando = false;
      cicloAtivo = undefined;
    }
  })();

  return cicloAtivo;
}

export function iniciarProcessadorOperacoesImagem() {
  if (timer || encerrando) return;
  timer = setInterval(() => void ciclo(), INTERVALO_MS);
  timer.unref?.();
  void ciclo();
}

export function pararProcessadorOperacoesImagem() {
  if (encerramentoAtivo) {
    return encerramentoAtivo;
  }

  encerrando = true;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }

  encerramentoAtivo = cicloAtivo || Promise.resolve();
  return encerramentoAtivo;
}
