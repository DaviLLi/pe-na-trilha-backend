import mongoose from "mongoose";
import { apresentarTrilha, identidadeLimpeza } from "../domain/fotoPublicacao.js";
import { CAMPOS_BASICOS, CARACTERISTICAS, STATUS_EDITAVEIS } from "../domain/publicacao.js";
import OperacaoImagem from "../models/OperacaoImagem.js";
import Trilha from "../models/Trilha.js";

export async function listarTrilhas(_req, res, next) {
  try {
    const trilhas = await Trilha.find({ status: "approved" }).sort({ createdAt: -1 });
    res.status(200).json(trilhas.map((trilha) => apresentarTrilha(trilha)));
  } catch (erro) {
    next(erro);
  }
}

export async function buscarTrilha(req, res, next) {
  try {
    const trilha = await Trilha.findOne({ _id: req.params.id, status: "approved" });

    if (!trilha) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }

    return res.status(200).json(apresentarTrilha(trilha));
  } catch (erro) {
    return next(erro);
  }
}

export async function criarTrilha(req, res, next) {
  try {
    if (req.body.caracteristicaPrincipal && !CARACTERISTICAS[req.body.tipoLocal]?.includes(req.body.caracteristicaPrincipal)) {
      return res.status(400).json({ mensagem: "Característica principal incompatível com o tipo de local." });
    }
    const trilha = await Trilha.create({
      ...req.body,
      status: "pending",
      proprietario: req.usuario._id,
    });
    res.status(201).json(apresentarTrilha(trilha, "autor"));
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarTrilha(req, res, next) {
  try {
    const filtro = { _id: req.params.id, proprietario: req.usuario._id };
    const atual = await Trilha.findOne(filtro);
    if (!atual) return res.status(404).json({ mensagem: "Trilha não encontrada." });
    if (![...STATUS_EDITAVEIS, "approved"].includes(atual.status)) {
      return res.status(409).json({ mensagem: "Publicação sem status válido; requer revisão administrativa." });
    }
    if (atual.status === "approved" && CAMPOS_BASICOS.some((campo) => Object.hasOwn(req.body, campo))) {
      return res.status(403).json({ mensagem: "Publicações aprovadas permitem editar somente características e duração." });
    }
    const tipo = Object.hasOwn(req.body, "tipoLocal") ? req.body.tipoLocal : atual.tipoLocal;
    const dados = { ...req.body };
    if (Object.hasOwn(dados, "tipoLocal") && dados.tipoLocal !== atual.tipoLocal && !Object.hasOwn(dados, "caracteristicaPrincipal")) {
      dados.caracteristicaPrincipal = null;
    }
    const destaque = Object.hasOwn(dados, "caracteristicaPrincipal") ? dados.caracteristicaPrincipal : atual.caracteristicaPrincipal;
    if (destaque && !CARACTERISTICAS[tipo]?.includes(destaque)) {
      return res.status(400).json({ mensagem: "Característica principal incompatível com o tipo de local." });
    }
    const trilha = await Trilha.findOneAndUpdate(
      { ...filtro, status: atual.status, updatedAt: atual.updatedAt },
      { $set: dados },
      { returnDocument: "after", runValidators: true },
    );
    if (!trilha) return res.status(409).json({ mensagem: "Publicação alterada durante a edição. Recarregue e tente novamente." });

    return res.status(200).json(apresentarTrilha(trilha, "autor"));
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

      const fotos = (trilha.fotos || []).filter((foto) => foto.publicId);

      if (fotos.length) {
        await OperacaoImagem.create(
          fotos.map((foto) => ({
            ...identidadeLimpeza(foto),
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

export async function reenviarTrilha(req, res, next) {
  try {
    if (Object.keys(req.body || {}).length) return res.status(400).json({ mensagem: "Reenvio não aceita alterações de dados." });
    const trilha = await Trilha.findOneAndUpdate(
      { _id: req.params.id, proprietario: req.usuario._id, status: "rejected" },
      { $set: { status: "pending" }, $push: { historicoModeracao: { acao: "resubmitted", usuario: req.usuario._id, data: new Date() } } },
      { returnDocument: "after", runValidators: true },
    );
    if (!trilha) {
      const existe = await Trilha.exists({ _id: req.params.id, proprietario: req.usuario._id });
      return res.status(existe ? 409 : 404).json({ mensagem: existe ? "Somente publicações rejeitadas podem ser reenviadas." : "Trilha não encontrada." });
    }
    return res.status(200).json(apresentarTrilha(trilha, "autor"));
  } catch (erro) { return next(erro); }
}

export async function listarMinhasTrilhas(req, res, next) {
  try {
    const trilhas = await Trilha.find({ proprietario: req.usuario._id }).sort({ createdAt: -1 });
    return res.json(trilhas.map((trilha) => apresentarTrilha(trilha, "autor")));
  } catch (erro) { return next(erro); }
}

export async function moderarTrilha(req, res, next) {
  try {
    const { status, motivo } = req.body || {};
    if (Object.keys(req.body || {}).some((campo) => !["status", "motivo"].includes(campo)) || !["approved", "rejected"].includes(status)
      || (status === "rejected" && (typeof motivo !== "string" || !motivo.trim() || motivo.length > 2000))
      || (status === "approved" && motivo !== undefined)) {
      return res.status(400).json({ mensagem: "Decisão inválida; rejeição exige motivo de até 2000 caracteres." });
    }
    const trilha = await Trilha.findOneAndUpdate(
      { _id: req.params.id, status: "pending" },
      { $set: { status, motivoRejeicao: status === "rejected" ? motivo.trim() : null },
        $push: { historicoModeracao: { acao: status, usuario: req.usuario._id, motivo: status === "rejected" ? motivo.trim() : null, data: new Date() } } },
      { returnDocument: "after", runValidators: true },
    );
    if (!trilha) return res.status(409).json({ mensagem: "Publicação inexistente ou não está pendente." });
    return res.json(apresentarTrilha(trilha, "admin"));
  } catch (erro) { return next(erro); }
}

export async function listarPendentes(_req, res, next) {
  try {
    const trilhas = await Trilha.find({ status: "pending" }).sort({ createdAt: 1 });
    return res.json(trilhas.map((trilha) => apresentarTrilha(trilha, "admin")));
  }
  catch (erro) { return next(erro); }
}

export async function buscarMinhaTrilha(req, res, next) {
  try {
    const trilha = await Trilha.findOne({ _id: req.params.id, proprietario: req.usuario._id });
    if (!trilha) return res.status(404).json({ mensagem: "Trilha não encontrada." });
    return res.json(apresentarTrilha(trilha, "autor"));
  } catch (erro) { return next(erro); }
}
