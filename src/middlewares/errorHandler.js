export function rotaNaoEncontrada(req, res) {
  res.status(404).json({
    mensagem: `Rota ${req.method} ${req.originalUrl} não encontrada.`,
  });
}

export function tratarErros(erro, _req, res, _next) {
  if (erro.type === "entity.parse.failed") {
    return res.status(400).json({ mensagem: "O JSON enviado é inválido." });
  }

  if (erro.name === "ValidationError") {
    const mensagens = Object.values(erro.errors).map(
      (detalhe) => detalhe.message,
    );

    return res.status(400).json({
      mensagem: "Dados da trilha inválidos.",
      erros: mensagens,
    });
  }

  if (erro.name === "CastError") {
    return res.status(400).json({ mensagem: "ID de trilha inválido." });
  }

  console.error(erro);
  return res.status(500).json({ mensagem: "Erro interno do servidor." });
}
