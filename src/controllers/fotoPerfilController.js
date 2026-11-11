import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import OperacaoImagem from "../models/OperacaoImagem.js";
import Usuario from "../models/Usuario.js";
import {
  criarPublicIdFotoPerfil,
  enviarImagem,
} from "../services/cloudinaryService.js";

const DURACAO_LEASE_UPLOAD_MS = 2 * 60 * 1000;
const INTERVALO_HEARTBEAT_MS = 30000;

async function agendarLimpezaUpload(_id, leaseToken) {
  await OperacaoImagem.updateOne(
    { _id, estado: "uploading", uploadLeaseToken: leaseToken },
    {
      $set: {
        estado: "cleanup_pending",
        nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000),
        uploadLeaseToken: null,
        uploadLeaseUntil: null,
        ultimoErro: "Upload não foi associado ao perfil.",
      },
      $push: {
        historicoTentativas: {
          $each: [{ data: new Date(), erro: "Upload não foi associado ao perfil." }],
          $slice: -20,
        },
      },
    },
  );
}

export async function substituirFotoPerfil(req, res, next) {
  const leaseToken = randomUUID();
  const publicId = criarPublicIdFotoPerfil();
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
    let fotoAnterior;
    let usuarioSalvo;
    try {
      await sessao.withTransaction(async () => {
        const agora = new Date();
        const operacaoAtiva = await OperacaoImagem.findOneAndUpdate(
          {
            _id: operacao._id,
            estado: "uploading",
            uploadLeaseToken: leaseToken,
            uploadLeaseUntil: { $gt: agora },
          },
          {
            $set: {
              uploadLeaseUntil: new Date(agora.getTime() + DURACAO_LEASE_UPLOAD_MS),
            },
          },
          { returnDocument: "after", session: sessao },
        );

        if (!operacaoAtiva) {
          const erro = new Error("A operação de upload expirou. Tente novamente.");
          erro.status = 409;
          throw erro;
        }

        const usuario = await Usuario.findById(req.usuario._id)
          .select("+fotoPerfilPublicId")
          .session(sessao);
        if (!usuario) {
          const erro = new Error("Usuário não encontrado.");
          erro.status = 404;
          throw erro;
        }

        fotoAnterior = usuario.fotoPerfilPublicId;
        usuario.fotoPerfil = imagem.secureUrl;
        usuario.fotoPerfilPublicId = imagem.publicId;
        await usuario.save({ session: sessao });
        usuarioSalvo = usuario;

        if (fotoAnterior && fotoAnterior !== imagem.publicId) {
          await OperacaoImagem.create(
            [{ publicId: fotoAnterior, estado: "cleanup_pending", nextAttemptAt: new Date() }],
            { session: sessao },
          );
        }

        const concluida = await OperacaoImagem.updateOne(
          { _id: operacao._id, estado: "uploading", uploadLeaseToken: leaseToken },
          {
            $set: { estado: "completed", concluidoEm: new Date(), ultimoErro: null },
            $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 },
          },
          { session: sessao },
        );
        if (concluida.modifiedCount !== 1) {
          const erro = new Error("A operação de upload expirou. Tente novamente.");
          erro.status = 409;
          throw erro;
        }
      });
    } catch (erro) {
      try {
        await agendarLimpezaUpload(operacao._id, leaseToken);
      } catch (erroDeLimpeza) {
        console.error("Falha ao registrar limpeza de imagem:", erroDeLimpeza.message);
      }
      if (erro.status === 404) {
        return res.status(404).json({ mensagem: "Usuário não encontrado." });
      }
      if (erro.status === 409) {
        return res.status(409).json({ mensagem: erro.message });
      }
      return next(erro);
    } finally {
      await sessao.endSession();
    }

    return res.status(200).json({
      fotoPerfil: usuarioSalvo.fotoPerfil,
    });
  } catch (erro) {
    if (operacao && uploadConcluido) {
      try {
        await agendarLimpezaUpload(operacao._id, leaseToken);
      } catch (erroDeLimpeza) {
        console.error("Falha ao registrar limpeza de imagem:", erroDeLimpeza.message);
      }
    }
    return next(erro);
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

export async function removerFotoPerfil(req, res, next) {
  const sessao = await mongoose.startSession();
  try {
    let fotoAnterior;
    await sessao.withTransaction(async () => {
      const usuario = await Usuario.findById(req.usuario._id)
        .select("+fotoPerfilPublicId")
        .session(sessao);
      if (!usuario) {
        const erro = new Error("Usuário não encontrado.");
        erro.status = 404;
        throw erro;
      }

      fotoAnterior = usuario.fotoPerfilPublicId;
      usuario.fotoPerfil = null;
      usuario.fotoPerfilPublicId = null;
      await usuario.save({ session: sessao });

      if (fotoAnterior) {
        await OperacaoImagem.create(
          [{ publicId: fotoAnterior, estado: "cleanup_pending", nextAttemptAt: new Date() }],
          { session: sessao },
        );
      }
    });

    return res.status(200).json({ fotoPerfil: null });
  } catch (erro) {
    if (erro.status === 404) {
      return res.status(404).json({ mensagem: "Usuário não encontrado." });
    }
    return next(erro);
  } finally {
    await sessao.endSession();
  }
}
