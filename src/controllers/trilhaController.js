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
    const trilha = await Trilha.create(req.body);
    res.status(201).json(trilha);
  } catch (erro) {
    next(erro);
  }
}

export async function atualizarTrilha(req, res, next) {
  try {
    const trilha = await Trilha.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!trilha) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }

    return res.status(200).json(trilha);
  } catch (erro) {
    return next(erro);
  }
}

export async function excluirTrilha(req, res, next) {
  try {
    const trilha = await Trilha.findByIdAndDelete(req.params.id);

    if (!trilha) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }

    return res.status(204).send();
  } catch (erro) {
    return next(erro);
  }
}
