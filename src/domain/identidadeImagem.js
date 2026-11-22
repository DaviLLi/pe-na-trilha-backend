export const PASTA_HOMOLOGACAO = "homologacao";
const HEX = "[a-fA-F0-9]";
const UUID = `${HEX}{8}(?:-${HEX}{4}){3}-${HEX}{12}`;

export function prefixoImagensHomologacao(runId) {
  if (runId === undefined) return PASTA_HOMOLOGACAO;
  if (typeof runId !== "string" || runId.length !== 32 || !/^[a-f0-9]{32}$/.test(runId)) {
    throw new Error("Identificador de homologação Cloudinary inválido.");
  }
  return `${PASTA_HOMOLOGACAO}/integracao/${runId}`;
}

export function validarPrefixoHomologacao(valor) {
  if (valor !== PASTA_HOMOLOGACAO && valor !== `${PASTA_HOMOLOGACAO}/`) {
    throw new Error("HOMOLOGATION_CLOUDINARY_PREFIX deve reservar homologacao/.");
  }
  return PASTA_HOMOLOGACAO;
}

export function validarModoPastaHomologacao(valor) {
  if (valor !== "dynamic" && valor !== "fixed") {
    throw new Error("Defina HOMOLOGATION_CLOUDINARY_FOLDER_MODE como dynamic ou fixed.");
  }
  return valor;
}

export function escopoImagensHomologacao(ambiente = process.env) {
  if (ambiente.APP_ENV === "production") return undefined;
  if (ambiente.APP_ENV === "homologation") {
    return validarPrefixoHomologacao(ambiente.HOMOLOGATION_CLOUDINARY_PREFIX);
  }
  if (ambiente.CLOUDINARY_HOMOLOGACAO_RUN_ID !== undefined) {
    validarPrefixoHomologacao(ambiente.HOMOLOGATION_CLOUDINARY_PREFIX);
    return prefixoImagensHomologacao(ambiente.CLOUDINARY_HOMOLOGACAO_RUN_ID);
  }
}

export function padraoImagemDaHomologacao(escopo = escopoImagensHomologacao()) {
  if (escopo) {
    return new RegExp(`^${escopo}/(?:perfis/${UUID}|trilhas/${HEX}{24}/${UUID})(?![\\s\\S])`);
  }
}

function dentroDoPadrao(publicId, padrao) {
  return !padrao || (typeof publicId === "string" && padrao.test(publicId));
}

export function imagemNoEscopo(publicId) {
  return dentroDoPadrao(publicId, padraoImagemDaHomologacao());
}

function erroImagemForaDoEscopo() {
  return Object.assign(new Error("Imagem fora do escopo de homologação."), { status: 409 });
}

export function validarImagemDaHomologacao(publicId, runId) {
  const padrao = runId === undefined
    ? padraoImagemDaHomologacao()
    : padraoImagemDaHomologacao(prefixoImagensHomologacao(runId));
  if (!dentroDoPadrao(publicId, padrao)) throw erroImagemForaDoEscopo();
}

export function apresentarUrlFotoPerfil(url, publicId) {
  if (!escopoImagensHomologacao()) return url;
  if (typeof url !== "string" || !url) return null;
  try {
    const endereco = new URL(url);
    const caminho = `/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`;
    if (endereco.origin !== "https://res.cloudinary.com" || endereco.username || endereco.password
      || endereco.search || endereco.hash || !endereco.pathname.startsWith(caminho)) return null;
    const nome = endereco.pathname.slice(caminho.length).replace(/^v[0-9]+\//, "");
    const extensao = /\.(?:jpe?g|png|webp)$/.exec(nome);
    const id = extensao && nome.slice(0, extensao.index);
    if (id && id.includes("/perfis/") && imagemNoEscopo(id) && (publicId === undefined || publicId === id)) {
      return endereco.href;
    }
  } catch {
    // URLs inválidas não são expostas pelo ambiente de homologação.
  }
  return null;
}

export function validarFotoPerfilDaHomologacao({ fotoPerfil, fotoPerfilPublicId }) {
  if (!escopoImagensHomologacao() || (!fotoPerfil && !fotoPerfilPublicId)) return;
  validarImagemDaHomologacao(fotoPerfilPublicId);
  if (!apresentarUrlFotoPerfil(fotoPerfil, fotoPerfilPublicId)) throw erroImagemForaDoEscopo();
}
