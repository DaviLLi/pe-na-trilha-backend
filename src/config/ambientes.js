import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { resolve } from "node:path";

export function obterAmbienteAplicacao(ambiente) {
  const alvo = ambiente.APP_ENV ?? ambiente.NODE_ENV;
  if ((alvo === "development" && ambiente.NODE_ENV === "development")
    || (["production", "homologation"].includes(alvo) && ambiente.NODE_ENV === "production")) {
    return alvo;
  }
  throw new Error("NODE_ENV deve ser development ou production e corresponder ao APP_ENV.");
}

export function lerArquivoAmbiente(arquivo) {
  try {
    return parse(readFileSync(resolve(arquivo)));
  } catch (erro) {
    if (erro?.code === "ENOENT") return {};
    throw new Error(`Não foi possível ler ${arquivo}.`, { cause: erro });
  }
}
