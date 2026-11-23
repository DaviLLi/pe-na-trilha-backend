import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { resolve } from "node:path";

export function obterAmbienteAplicacao(ambiente) {
  const alvo = ambiente.APP_ENV ?? ambiente.NODE_ENV;
  if (["production", "homologation"].includes(alvo) && ambiente.NODE_ENV === "production") {
    return alvo;
  }
  throw new Error("Use NODE_ENV=production com APP_ENV=production ou homologation.");
}

export function lerArquivoAmbiente(arquivo) {
  try {
    return parse(readFileSync(resolve(arquivo)));
  } catch (erro) {
    if (erro?.code === "ENOENT") return {};
    throw new Error(`Não foi possível ler ${arquivo}.`, { cause: erro });
  }
}
