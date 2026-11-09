const nomeUsuarioValido = /^\p{L}[\p{L}\p{M}]*$/u;
const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function senhaValida(senha) {
  return (
    typeof senha === "string" &&
    [...senha].length >= 8 &&
    Buffer.byteLength(senha, "utf8") <= 72 &&
    /\p{Lu}/u.test(senha) &&
    /\p{Ll}/u.test(senha) &&
    /\p{N}/u.test(senha) &&
    /[\p{P}\p{S}]/u.test(senha)
  );
}

export function validarUsuario(req, res, next) {
  const entrada = req.body;
  const nomeCompleto = entrada?.nomeCompleto;
  const nomeUsuario = entrada?.nomeUsuario;
  const email = entrada?.email;
  const senha = entrada?.senha;
  const fotoPerfil = entrada?.fotoPerfil;

  if (fotoPerfil !== undefined && fotoPerfil !== null && fotoPerfil !== "") {
    return res.status(400).json({
      mensagem: "A foto de perfil deve ser enviada pelo endpoint autenticado.",
    });
  }

  if (typeof nomeCompleto !== "string" || !nomeCompleto.trim()) {
    return res.status(400).json({
      mensagem: "O nome completo é obrigatório.",
    });
  }

  if (typeof nomeUsuario !== "string" || !nomeUsuario.trim()) {
    return res.status(400).json({
      mensagem: "O nome de usuário é obrigatório.",
    });
  }

  const nomeUsuarioNormalizado = nomeUsuario
    .trim()
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFC");

  if (!nomeUsuarioValido.test(nomeUsuarioNormalizado)) {
    return res.status(400).json({
      mensagem:
        "O nome de usuário deve conter somente letras, sem números, espaços ou símbolos.",
    });
  }

  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({
      mensagem: "O e-mail é obrigatório.",
    });
  }

  const emailNormalizado = email.trim().toLowerCase();

  if (!emailValido.test(emailNormalizado)) {
    return res.status(400).json({
      mensagem: "O e-mail informado é inválido.",
    });
  }

  if (!senhaValida(senha)) {
    return res.status(400).json({
      mensagem:
        "A senha deve ter no mínimo 8 caracteres, no máximo 72 bytes e conter letra maiúscula, letra minúscula, número e caractere especial.",
    });
  }

  req.body = {
    nomeCompleto: nomeCompleto.trim(),
    nomeUsuario: nomeUsuarioNormalizado,
    email: emailNormalizado,
    senha,
    fotoPerfil: null,
    perfil: "user",
  };

  return next();
}
