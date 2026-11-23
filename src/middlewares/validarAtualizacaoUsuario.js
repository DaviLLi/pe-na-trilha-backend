const CAMPOS_ATUALIZAVEIS = new Set(["nomeCompleto", "nomeUsuario", "email"]);
const nomeUsuarioValido = /^\p{L}[\p{L}\p{M}]*$/u;
const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function responderInvalido(res, mensagem = "Dados do usuário inválidos.") {
  return res.status(400).json({ mensagem });
}

export function validarAtualizacaoUsuario(req, res, next) {
  const entrada = req.body;
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return responderInvalido(res);
  }

  const campos = Object.keys(entrada);
  if (!campos.length || campos.some((campo) => !CAMPOS_ATUALIZAVEIS.has(campo))) {
    return responderInvalido(res);
  }

  const dados = {};
  for (const campo of campos) {
    const valor = entrada[campo];
    if (typeof valor !== "string" || !valor.trim()) {
      return responderInvalido(res);
    }

    const normalizado = valor.trim().normalize("NFC");
    if (campo === "nomeCompleto") {
      dados[campo] = normalizado;
      continue;
    }

    const comparavel = normalizado.toLowerCase().normalize("NFC");
    if (campo === "nomeUsuario") {
      if (!nomeUsuarioValido.test(comparavel)) {
        return responderInvalido(
          res,
          "O nome de usuário deve conter somente letras, sem números, espaços ou símbolos.",
        );
      }
      dados[campo] = comparavel;
      continue;
    }

    if (!emailValido.test(comparavel)) {
      return responderInvalido(res, "O e-mail informado é inválido.");
    }
    dados[campo] = comparavel;
  }

  req.body = dados;
  return next();
}
