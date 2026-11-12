function normalizarOrigem(valor) {
  const origem = valor.trim();
  const url = new URL(origem);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origem.replace(/\/$/, "")
  ) {
    throw new Error("Cada origem frontend deve conter somente protocolo e host.");
  }

  return url.origin;
}

export function obterOrigensFrontend(ambiente = process.env) {
  const configuracao =
    ambiente.FRONTEND_ORIGINS ||
    ambiente.FRONTEND_URL ||
    "http://localhost:5173";

  return new Set(configuracao.split(",").map(normalizarOrigem));
}

export function origemFrontendPermitida(origem, ambiente = process.env) {
  if (typeof origem !== "string" || !origem) {
    return false;
  }

  return obterOrigensFrontend(ambiente).has(origem);
}
