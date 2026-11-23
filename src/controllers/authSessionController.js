import {
  definirCookiesAuth,
  limparCookiesAuth,
  lerCookie,
  nomeCookieRefresh,
} from "../config/authCookies.js";
import { gerarTokenCsrf } from "../config/csrf.js";
import { dadosPublicosUsuario } from "./usuarioController.js";
import {
  revogarSessao,
  rotacionarRefreshToken,
} from "../services/authSessionService.js";

export async function renovarSessao(req, res, next) {
  try {
    const refreshToken = lerCookie(req, nomeCookieRefresh());
    const sessao = await rotacionarRefreshToken(refreshToken);

    if (sessao?.concorrente) {
      return res.status(409).json({
        mensagem: "A renovação da sessão já está em andamento; tente novamente.",
      });
    }

    if (sessao?.reutilizado) {
      limparCookiesAuth(res);
      return res.status(401).json({ mensagem: "Sessão inválida ou expirada." });
    }

    if (!sessao) {
      limparCookiesAuth(res);
      return res.status(401).json({ mensagem: "Sessão inválida ou expirada." });
    }

    definirCookiesAuth(res, sessao);
    return res.status(200).json({ usuario: dadosPublicosUsuario(sessao.usuario) });
  } catch (erro) {
    return next(erro);
  }
}

export function consultarTokenCsrf(req, res) {
  if (!req.authSession) {
    return res.status(401).json({
      mensagem: "Autenticação inválida ou expirada.",
    });
  }

  return res.status(200).json({
    csrfToken: gerarTokenCsrf(req.authSession._id),
  });
}

export async function logoutUsuario(req, res, next) {
  try {
    await revogarSessao(req.authSession._id);
    limparCookiesAuth(res);
    return res.status(204).send();
  } catch (erro) {
    return next(erro);
  }
}
