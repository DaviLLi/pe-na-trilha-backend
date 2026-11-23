export const TEMPO_EXPIRACAO_JWT = "15m";
export const ALGORITMO_JWT = "HS256";

export function obterChaveJwt() {
  const segredo = process.env.JWT_SECRET;

  if (typeof segredo !== "string" || Buffer.byteLength(segredo, "utf8") < 32) {
    throw new Error("JWT_SECRET deve conter pelo menos 32 bytes aleatórios.");
  }

  return new TextEncoder().encode(segredo);
}
