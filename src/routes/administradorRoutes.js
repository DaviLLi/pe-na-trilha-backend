import express, { Router } from "express";
import { autenticarToken } from "../middlewares/autenticarToken.js";
import { validarCsrf } from "../middlewares/validarCsrf.js";
import { ErroGerenciamentoAdmin } from "../services/errosGerenciamentoAdmin.js";
import {
  alterarPerfilAdmin, conferirAdminPrincipal, listarAdministradores,
} from "../services/gerenciarAdministradores.js";

const router = Router();
const lerJson = express.json({ limit: "2kb", inflate: false });

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use(autenticarToken, async (req, _res, next) => {
  await conferirAdminPrincipal(req.usuario);
  if (req.authMethod !== "cookie") throw new ErroGerenciamentoAdmin("SESSAO_COOKIE");
  next();
});

router.get("/", async (req, res) => {
  res.json({ administradores: await listarAdministradores(req.usuario._id) });
});

function gerenciar(acao) {
  return async (req, res) => {
    const { email, senha } = req.body ?? {};
    const campos = Object.keys(req.body ?? {});
    req.body = undefined;
    if (campos.length !== 2 || !campos.includes("email") || !campos.includes("senha")) {
      throw new ErroGerenciamentoAdmin("ENTRADA");
    }
    await alterarPerfilAdmin({ acao, email, senha, operadorId: req.usuario._id, confirmado: true });
    res.sendStatus(204);
  };
}

router.post("/promover", validarCsrf, lerJson, gerenciar("promover"));
router.post("/remover", validarCsrf, lerJson, gerenciar("remover"));
router.use((_req, res) => res.status(404).json({ mensagem: "Rota não encontrada." }));

const respostas = {
  ENTRADA: [400, "Informe somente e-mail e senha."],
  EMAIL_INVALIDO: [400, "E-mail inválido."],
  SENHA_INVALIDA: [400, "Informe sua senha atual."],
  ACESSO_PRINCIPAL: [403, "Acesso exclusivo do administrador principal."],
  SESSAO_COOKIE: [403, "Use a sessão por cookie para acessar esta operação."],
  MARCADOR_INDISPONIVEL: [403, "Acesso exclusivo do administrador principal."],
  ADMIN_ORIGINAL_INATIVO: [403, "Acesso exclusivo do administrador principal."],
  IDENTIDADE_NAO_CONFIRMADA: [403, "Não foi possível confirmar sua identidade."],
  ADMIN_ORIGINAL: [403, "A conta do administrador principal está protegida."],
  CONTA_INEXISTENTE: [404, "Conta não encontrada."],
  JA_ADMIN: [409, "Essa conta já é administradora."],
  NAO_ADMIN: [409, "Essa conta não é administradora."],
  EMAIL_AMBIGUO: [409, "Esse e-mail identifica mais de uma conta."],
  CONTA_ALTERADA: [409, "A conta mudou. Verifique o alvo e tente novamente."],
  LIMITE_TENTATIVAS: [429, "Limite de tentativas atingido. Tente mais tarde."],
};

router.use((erro, req, res, next) => {
  void next;
  req.body = undefined;
  if (erro instanceof ErroGerenciamentoAdmin && Object.hasOwn(respostas, erro.codigo)) {
    const [status, mensagem] = respostas[erro.codigo];
    return res.status(status).json({ mensagem });
  }
  if (erro.type === "entity.parse.failed") return res.status(400).json({ mensagem: "O JSON enviado é inválido." });
  if (erro.type === "entity.too.large") return res.status(413).json({ mensagem: "Corpo da requisição muito grande." });
  if (erro.type === "encoding.unsupported" || erro.type === "charset.unsupported") {
    return res.status(415).json({ mensagem: "Formato de requisição não suportado." });
  }
  // Exceções do parser e do driver podem carregar dados da operação.
  console.error("Falha interna no gerenciamento administrativo.");
  return res.status(500).json({ mensagem: "Erro interno do servidor." });
});

export default router;
