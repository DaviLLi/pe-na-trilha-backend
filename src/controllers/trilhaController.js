import mongoose from "mongoose";
import OperacaoImagem from "../models/OperacaoImagem.js";
import Trilha from "../models/Trilha.js";

export async function listarTrilhas(_req, res, next) {
  try {
    const trilhas = await Trilha.find().sort({ createdAt: -1 });
    res.status(200).json(trilhas);
  } catch (erro) {
    next(erro);
  }
}

export async function buscarTrilha(req, res, next) {
  try {
    const trilha = await Trilha.findById(req.params.id);

    if (!trilha) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }

    return res.status(200).json(trilha);
  } catch (erro) {
    return next(erro);
  }
}

export async function criarTrilha(req, res, next) {
  try {
    const { titulo, descricao, endereco } = req.body;
    const trilha = await Trilha.create({
      titulo,
      descricao,
      endereco,
      proprietario: req.usuario._id,
    });
    res.status(201).json(trilha);
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarTrilha(req, res, next) {
  try {
    const trilha = await Trilha.findOneAndUpdate(
      { _id: req.params.id, proprietario: req.usuario._id },
      req.body,
      { returnDocument: "after", runValidators: true },
    );

    if (!trilha) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }

    return res.status(200).json(trilha);
  } catch (erro) {
    return next(erro);
  }
}

export async function excluirTrilha(req, res, next) {
  const sessao = await mongoose.startSession();
  try {
    await sessao.withTransaction(async () => {
      const trilha = await Trilha.findOneAndDelete({
        _id: req.params.id,
        proprietario: req.usuario._id,
      }).session(sessao);

      if (!trilha) {
        const erro = new Error("Trilha não encontrada.");
        erro.status = 404;
        throw erro;
      }

      const publicIds = (trilha.fotos || [])
        .map((foto) => foto.publicId)
        .filter(Boolean);

      if (publicIds.length) {
        await OperacaoImagem.create(
          publicIds.map((publicId) => ({
            publicId,
            estado: "cleanup_pending",
            nextAttemptAt: new Date(),
          })),
          { session: sessao },
        );
      }
    });

    return res.status(204).send();
  } catch (erro) {
    if (erro.status === 404) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }
    return next(erro);
  } finally {
    await sessao.endSession();
  }
}
