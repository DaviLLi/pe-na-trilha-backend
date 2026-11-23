import { lerArquivoAmbiente, obterAmbienteAplicacao } from "./ambientes.js";

const arquivoPorAmbiente = {
  production: ".env.production",
  homologation: ".env.homologation",
};
const ambiente = obterAmbienteAplicacao(process.env);
for (const [chave, valor] of Object.entries(lerArquivoAmbiente(arquivoPorAmbiente[ambiente]))) {
  if (chave !== "NODE_ENV" && chave !== "APP_ENV") process.env[chave] ??= valor;
}
if (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_ACCOUNT_URL) {
  throw new Error("Configure o Cloudinary somente com os três campos do ambiente selecionado.");
}
