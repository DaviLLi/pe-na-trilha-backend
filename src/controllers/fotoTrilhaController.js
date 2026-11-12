import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { STATUS_EDITAVEIS } from "../domain/publicacao.js";
import OperacaoImagem from "../models/OperacaoImagem.js";
import Trilha from "../models/Trilha.js";
import {
  criarPublicIdFotoTrilha,
  enviarImagem,
} from "../services/cloudinaryService.js";

const DURACAO_LEASE_UPLOAD_MS = 2 * 60 * 1000;
const INTERVALO_HEARTBEAT_MS = 30000;
const MAX_FOTOS_TRILHA = 5;

function erroHttp(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function fotoPublica(foto) {
  return {
    _id: foto._id,
    url: foto.url,
    createdAt: foto.createdAt,
    updatedAt: foto.updatedAt,
  };
}

async function agendarLimpezaUpload(id, leaseToken) {
  await OperacaoImagem.updateOne(
    { _id: id, estado: "uploading", uploadLeaseToken: leaseToken },
    {
      $set: {
        estado: "cleanup_pending",
        nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000),
        uploadLeaseToken: null,
        uploadLeaseUntil: null,
        ultimoErro: "Upload não foi associado à trilha.",
      },
      $push: {
        historicoTentativas: {
          $each: [{ data: new Date(), erro: "Upload não foi associado à trilha." }],
          $slice: -20,
        },
      },
    },
  );
}

async function executarUpload(req, res, next, salvarFoto, statusSucesso) {
  const leaseToken = randomUUID();
  const publicId = criarPublicIdFotoTrilha(req.params.id);
  let operacao;
  let uploadConcluido = false;
  let heartbeat;

  try {
    operacao = await OperacaoImagem.create({
      publicId,
      estado: "uploading",
      uploadLeaseToken: leaseToken,
      uploadLeaseUntil: new Date(Date.now() + DURACAO_LEASE_UPLOAD_MS),
    });

    heartbeat = setInterval(() => {
      void OperacaoImagem.updateOne(
        { _id: operacao._id, estado: "uploading", uploadLeaseToken: leaseToken },
        { $set: { uploadLeaseUntil: new Date(Date.now() + DURACAO_LEASE_UPLOAD_MS) } },
      ).catch((erro) => console.error("Falha ao renovar lease de upload:", erro.message));
    }, INTERVALO_HEARTBEAT_MS);
    heartbeat.unref?.();

    let imagem;
    try {
      imagem = await enviarImagem(req.imagemValidada, publicId);
      uploadConcluido = true;
    } catch {
      await agendarLimpezaUpload(operacao._id, leaseToken);
      return res.status(502).json({ mensagem: "Não foi possível enviar a imagem." });
    }

    const sessao = await mongoose.startSession();
    let fotoSalva;
    try {
      await sessao.withTransaction(async () => {
        const agora = new Date();
        const reservaAtiva = await OperacaoImagem.findOneAndUpdate(
          {
            _id: operacao._id,
            estado: "uploading",
            uploadLeaseToken: leaseToken,
            uploadLeaseUntil: { $gt: agora },
          },
          { $set: { uploadLeaseUntil: new Date(agora.getTime() + DURACAO_LEASE_UPLOAD_MS) } },
          { returnDocument: "after", session: sessao },
        );

        if (!reservaAtiva) {
          throw erroHttp(409, "A operação de upload expirou. Tente novamente.");
        }

        fotoSalva = await salvarFoto(imagem, sessao);

        const concluida = await OperacaoImagem.updateOne(
          { _id: operacao._id, estado: "uploading", uploadLeaseToken: leaseToken },
          {
            $set: { estado: "completed", concluidoEm: new Date(), ultimoErro: null },
            $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 },
          },
          { session: sessao },
        );
        if (concluida.modifiedCount !== 1) {
          throw erroHttp(409, "A operação de upload expirou. Tente novamente.");
        }
      });
    } finally {
      await sessao.endSession();
    }

    return res.status(statusSucesso).json(fotoPublica(fotoSalva));
  } catch (erro) {
    if (operacao && uploadConcluido) {
      try {
        await agendarLimpezaUpload(operacao._id, leaseToken);
      } catch (erroDeLimpeza) {
        console.error("Falha ao registrar limpeza de imagem:", erroDeLimpeza.message);
      }
    }

    if (erro.status) {
      return res.status(erro.status).json({ mensagem: erro.message });
    }

    return next(erro);
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

export async function adicionarFotoTrilha(req, res, next) {
  const foto = {
    _id: new mongoose.Types.ObjectId(),
    url: null,
    publicId: null,
  };

  return executarUpload(
    req,
    res,
    next,
    async (imagem, sessao) => {
      const trilha = await Trilha.findOneAndUpdate(
        {
          _id: req.params.id,
          proprietario: req.usuario._id,
          status: { $in: STATUS_EDITAVEIS },
          $expr: {
            $lt: [{ $size: { $ifNull: ["$fotos", []] } }, MAX_FOTOS_TRILHA],
          },
        },
        {
          $push: {
            fotos: {
              ...foto,
              url: imagem.secureUrl,
              publicId: imagem.publicId,
            },
          },
        },
        { returnDocument: "after", session: sessao },
      );

      if (!trilha) {
        const trilhaDoProprietario = await Trilha.findOne({
          _id: req.params.id,
          proprietario: req.usuario._id,
          status: { $in: STATUS_EDITAVEIS },
        }).session(sessao);

        if (!trilhaDoProprietario) {
          throw erroHttp(404, "Trilha não encontrada.");
        }
        throw erroHttp(409, "A trilha já possui o limite de 5 fotos.");
      }

      return trilha.fotos.id(foto._id);
    },
    201,
  );
}

export async function substituirFotoTrilha(req, res, next) {
  return executarUpload(
    req,
    res,
    next,
    async (imagem, sessao) => {
      const trilha = await Trilha.findOne({
        _id: req.params.id,
        proprietario: req.usuario._id,
        status: { $in: STATUS_EDITAVEIS },
        "fotos._id": req.params.fotoId,
      }).session(sessao);

      if (!trilha) {
        throw erroHttp(404, "Foto da trilha não encontrada.");
      }

      const foto = trilha.fotos.id(req.params.fotoId);
      const publicIdAnterior = foto.publicId;
      foto.url = imagem.secureUrl;
      foto.publicId = imagem.publicId;
      foto.updatedAt = new Date();
      await trilha.save({ session: sessao });

      if (publicIdAnterior && publicIdAnterior !== imagem.publicId) {
        await OperacaoImagem.create(
          [{ publicId: publicIdAnterior, estado: "cleanup_pending", nextAttemptAt: new Date() }],
          { session: sessao },
        );
      }

      return foto;
    },
    200,
  );
}

export async function removerFotoTrilha(req, res, next) {
  const sessao = await mongoose.startSession();
  try {
    await sessao.withTransaction(async () => {
      const trilha = await Trilha.findOne({
        _id: req.params.id,
        proprietario: req.usuario._id,
        status: { $in: STATUS_EDITAVEIS },
        "fotos._id": req.params.fotoId,
      }).session(sessao);

      if (!trilha) {
        throw erroHttp(404, "Foto da trilha não encontrada.");
      }

      const foto = trilha.fotos.id(req.params.fotoId);
      const publicId = foto.publicId;
      trilha.fotos.pull({ _id: req.params.fotoId });
      await trilha.save({ session: sessao });

      if (publicId) {
        await OperacaoImagem.create(
          [{ publicId, estado: "cleanup_pending", nextAttemptAt: new Date() }],
          { session: sessao },
        );
      }
    });

    return res.status(204).send();
  } catch (erro) {
    if (erro.status) {
      return res.status(erro.status).json({ mensagem: erro.message });
    }
    return next(erro);
  } finally {
    await sessao.endSession();
  }
}
