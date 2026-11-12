export const TEMPO_ACCESS_TOKEN_MS = 15 * 60 * 1000;
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;

function configuracaoCookie(ambiente = process.env) {
  const secure = ambiente.NODE_ENV === "production";
  const sameSite = (
    ambiente.AUTH_COOKIE_SAME_SITE || (secure ? "none" : "lax")
  ).toLowerCase();

  if (!["strict", "lax", "none"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE deve ser strict, lax ou none.");
  }

  if (sameSite === "none" && !secure) {
    throw new Error("SameSite=None exige cookies Secure.");
  }

  return {
    secure,
    sameSite,
    path: "/",
    httpOnly: true,
  };
}

export function validarConfiguracaoCookies(ambiente = process.env) {
  configuracaoCookie(ambiente);
}

export function nomeCookieAccess(ambiente = process.env) {
  return ambiente.NODE_ENV === "production"
    ? "__Host-pnt_access"
    : "pnt_access";
}

export function nomeCookieRefresh(ambiente = process.env) {
  return ambiente.NODE_ENV === "production"
    ? "__Host-pnt_refresh"
    : "pnt_refresh";
}

export function lerCookie(req, nome) {
  const cabecalho = req.headers?.cookie;
  if (typeof cabecalho !== "string") return null;

  for (const parte of cabecalho.split(";")) {
    const separador = parte.indexOf("=");
    if (separador < 0) continue;

    if (parte.slice(0, separador).trim() === nome) {
      return parte.slice(separador + 1).trim() || null;
    }
  }

  return null;
}

export function definirCookiesAuth(res, { accessToken, refreshToken, expiraEm }) {
  const base = configuracaoCookie();
  const maxAgeRefresh = Math.max(0, expiraEm.getTime() - Date.now());

  res.cookie(nomeCookieAccess(), accessToken, {
    ...base,
    maxAge: TEMPO_ACCESS_TOKEN_MS,
  });
  res.cookie(nomeCookieRefresh(), refreshToken, {
    ...base,
    maxAge: maxAgeRefresh,
  });
}

export function limparCookiesAuth(res) {
  limparCookieAccess(res);
  res.clearCookie(nomeCookieRefresh(), configuracaoCookie());
}

export function limparCookieAccess(res) {
  const opcoes = configuracaoCookie();
  res.clearCookie(nomeCookieAccess(), opcoes);
}
