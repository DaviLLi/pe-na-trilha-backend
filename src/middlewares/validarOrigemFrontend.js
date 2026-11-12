import { origemFrontendPermitida } from "../config/origensFrontend.js";

export function validarOrigemFrontend(req, res, next) {
  const origem = req.get("origin");

  if (!origemFrontendPermitida(origem)) {
    return res.status(403).json({ mensagem: "Origem não permitida." });
  }

  return next();
}
