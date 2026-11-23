import { tokenCsrfValido } from "../config/csrf.js";

export function validarCsrf(req, res, next) {
  if (req.authMethod !== "cookie") {
    return next();
  }

  if (!tokenCsrfValido(req.get("x-csrf-token"), req.authSession._id)) {
    return res.status(403).json({ mensagem: "Token CSRF ausente ou inválido." });
  }

  return next();
}
