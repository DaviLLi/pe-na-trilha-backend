import Trilha from "../models/Trilha.js";

export async function validarProprietarioTrilha(req, res, next) {
  const filtro = {
    _id: req.params.id,
    proprietario: req.usuario._id,
  };

  if (req.params.fotoId) {
    filtro["fotos._id"] = req.params.fotoId;
  }

  try {
    const trilha = await Trilha.exists(filtro);
    if (!trilha) {
      return res.status(404).json({ mensagem: "Trilha não encontrada." });
    }

    return next();
  } catch (erro) {
    return next(erro);
  }
}

export async function validarEdicaoFotos(req, res, next) {
  try {
    const trilha = await Trilha.findOne({ _id: req.params.id, proprietario: req.usuario._id });
    if (!trilha) return res.status(404).json({ mensagem: "Trilha não encontrada." });
    if (!["pending", "rejected"].includes(trilha.status)) {
      return res.status(403).json({ mensagem: "Fotos só podem ser alteradas em publicações pendentes ou rejeitadas." });
    }
    return next();
  } catch (erro) { return next(erro); }
}

export function exigirAdmin(req, res, next) {
  if (req.usuario.perfil !== "admin") return res.status(403).json({ mensagem: "Acesso administrativo obrigatório." });
  return next();
}
