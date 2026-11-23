export function validarLogin(req, res, next) {
  const identificador = req.body?.identificador;
  const senha = req.body?.senha;

  if (
    typeof identificador !== "string" ||
    !identificador.trim() ||
    typeof senha !== "string" ||
    !senha
  ) {
    return res.status(400).json({
      mensagem: "Identificador e senha são obrigatórios.",
    });
  }

  if (Buffer.byteLength(senha, "utf8") > 72) {
    return res.status(400).json({
      mensagem: "A senha informada é inválida.",
    });
  }

  req.body = {
    identificador: identificador
      .trim()
      .normalize("NFC")
      .toLowerCase()
      .normalize("NFC"),
    senha,
  };

  return next();
}
