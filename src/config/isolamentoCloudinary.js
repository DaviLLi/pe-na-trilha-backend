import { lerArquivoAmbiente } from "./ambientes.js";
import { validarModoPastaHomologacao, validarPrefixoHomologacao } from "../domain/identidadeImagem.js";

const CAMPOS = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];

export function validarCloudinaryHomologacao(ambiente, destinosConhecidos) {
  const prefixo = validarPrefixoHomologacao(ambiente.HOMOLOGATION_CLOUDINARY_PREFIX);
  const modo = validarModoPastaHomologacao(ambiente.HOMOLOGATION_CLOUDINARY_FOLDER_MODE);
  const credenciais = Object.fromEntries(CAMPOS.map((campo) => {
    const variavel = `HOMOLOGATION_${campo}`;
    const valor = ambiente[variavel]?.trim();
    if (!valor) throw new Error(`Informe ${variavel} no ambiente de homologação.`);
    return [campo, valor];
  }));
  if (!/^[a-zA-Z0-9_-]+$/.test(credenciais.CLOUDINARY_CLOUD_NAME)) {
    throw new Error("HOMOLOGATION_CLOUDINARY_CLOUD_NAME inválido.");
  }

  for (const destino of destinosConhecidos) {
    let chaveUrl;
    if (destino.CLOUDINARY_URL) {
      try {
        const url = new URL(destino.CLOUDINARY_URL);
        if (url.protocol !== "cloudinary:" || !url.hostname) throw new Error();
        chaveUrl = decodeURIComponent(url.username);
      } catch {
        throw new Error("Uma configuração conhecida de CLOUDINARY_URL é inválida.");
      }
    }
    if ([destino.CLOUDINARY_API_KEY?.trim(), chaveUrl].includes(credenciais.CLOUDINARY_API_KEY)) {
      throw new Error("Use uma API Key própria de homologação, diferente da chave já usada pela aplicação.");
    }
  }
  return {
    ...credenciais,
    HOMOLOGATION_CLOUDINARY_PREFIX: prefixo,
    HOMOLOGATION_CLOUDINARY_FOLDER_MODE: modo,
  };
}

export function obterCloudinaryHomologacao(ambiente, destinosAdicionais = []) {
  const conhecidos = [lerArquivoAmbiente(".env.production")];
  return validarCloudinaryHomologacao(ambiente, [...conhecidos, ...destinosAdicionais]);
}
