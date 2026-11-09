export function rotaNaoEncontrada(req, res) {
  res.status(404).json({
    mensagem: `Rota ${req.method} ${req.originalUrl} não encontrada.`,
  });
}

function requisicaoDeUsuario(req) {
  return /^\/usuarios(?:\/|\?|$)/.test(req.originalUrl || "");
}

export function tratarErros(erro, req, res, next) {
  void next;

  if (erro.name === "MulterError" || erro.code === "LIMIT_FILE_SIZE") {
    const status = erro.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const mensagem =
      erro.code === "LIMIT_FILE_SIZE"
        ? "A imagem excede o limite de 5 MiB."
        : "O envio da imagem contém campos, arquivos ou partes não permitidos.";
    return res.status(status).json({ mensagem });
  }

  if (erro.type === "multipart.parse") {
    return res.status(400).json({ mensagem: "A requisição multipart é inválida." });
  }

  if (erro.code === 11000) {
    const camposDuplicados = Object.keys(erro.keyPattern || erro.keyValue || {});

    if (camposDuplicados.includes("email")) {
      return res.status(409).json({
        mensagem: "Este e-mail já está cadastrado.",
      });
    }

    if (camposDuplicados.includes("nomeUsuario")) {
      return res.status(409).json({
        mensagem: "Este nome de usuário já está em uso.",
      });
    }

    return res.status(409).json({
      mensagem: "Nome de usuário ou e-mail já cadastrado.",
    });
  }

  if (erro.type === "entity.parse.failed") {
    return res.status(400).json({ mensagem: "O JSON enviado é inválido." });
  }

  if (erro.name === "ValidationError") {
    const mensagens = Object.values(erro.errors).map(
      (detalhe) => detalhe.message,
    );

    return res.status(400).json({
      mensagem: requisicaoDeUsuario(req)
        ? "Dados do usuário inválidos."
        : "Dados da trilha inválidos.",
      erros: mensagens,
    });
  }

  if (erro.name === "CastError") {
    const recurso = requisicaoDeUsuario(req)
      ? "usuário"
      : "trilha";
    return res.status(400).json({ mensagem: `ID de ${recurso} inválido.` });
  }

  console.error(erro);
  return res.status(500).json({ mensagem: "Erro interno do servidor." });
}
