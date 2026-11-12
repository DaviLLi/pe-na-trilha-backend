import { createHmac, timingSafeEqual } from "node:crypto";

export function obterSegredoCsrf(ambiente = process.env) {
  const segredo = ambiente.CSRF_SECRET;
  if (typeof segredo !== "string" || Buffer.byteLength(segredo, "utf8") < 32) {
    throw new Error("CSRF_SECRET deve conter pelo menos 32 bytes aleatórios.");
  }

  return segredo;
}

export function gerarTokenCsrf(sessionId, ambiente = process.env) {
  return createHmac("sha256", obterSegredoCsrf(ambiente))
    .update(`penatrilha:csrf:v1:${sessionId}`)
    .digest("base64url");
}

export function tokenCsrfValido(tokenRecebido, sessionId, ambiente = process.env) {
  if (typeof tokenRecebido !== "string") return false;

  const esperado = Buffer.from(gerarTokenCsrf(sessionId, ambiente));
  const recebido = Buffer.from(tokenRecebido);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
