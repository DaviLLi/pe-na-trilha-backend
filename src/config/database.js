import mongoose from "mongoose";

export function obterUriMongo(ambiente = process.env) {
  const configuracaoPorAmbiente = {
    development: {
      variavel: "MONGO_URI_DEVELOPMENT",
      descricao: "desenvolvimento",
    },
    production: {
      variavel: "MONGO_URI_PRODUCTION",
      descricao: "produção",
    },
  };
  const configuracao = Object.hasOwn(configuracaoPorAmbiente, ambiente.NODE_ENV)
    ? configuracaoPorAmbiente[ambiente.NODE_ENV]
    : undefined;

  if (!configuracao) {
    throw new Error(
      "NODE_ENV deve ser development ou production para conectar ao MongoDB.",
    );
  }

  const uri = ambiente[configuracao.variavel];
  if (typeof uri !== "string" || !uri.trim()) {
    throw new Error(
      `A variável ${configuracao.variavel} não foi definida para ${configuracao.descricao}.`,
    );
  }

  return uri;
}

export async function conectarBanco(ambiente = process.env) {
  await mongoose.connect(obterUriMongo(ambiente));
  console.log("MongoDB conectado.");
}
