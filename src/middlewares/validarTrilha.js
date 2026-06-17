const camposObrigatorios = ["titulo", "descricao", "endereco"];

export function validarTrilha(req, res, next) {
  const dados = {};

  for (const campo of camposObrigatorios) {
    const valor = req.body?.[campo];

    if (typeof valor !== "string" || !valor.trim()) {
      return res.status(400).json({
        mensagem: "Título, descrição e endereço são obrigatórios.",
      });
    }

    dados[campo] = valor.trim();
  }

  req.body = dados;
  return next();
}
