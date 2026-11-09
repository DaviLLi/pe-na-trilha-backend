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
