import { CAMPOS_BASICOS, CAMPOS_DETALHES } from "./publicacao.js";

const CAMPOS_PUBLICOS = ["_id", ...CAMPOS_BASICOS, ...CAMPOS_DETALHES, "proprietario", "status", "createdAt", "updatedAt"];

export function fotoProtegida(foto) {
  return foto.storageState === "ready" && foto.deliveryType === "authenticated"
    && foto.resourceType === "image" && typeof foto.assetId === "string" && foto.assetId.length > 0
    && typeof foto.publicId === "string" && foto.publicId.length > 0
    && Number.isInteger(foto.version) && foto.version > 0
    && ["jpg", "jpeg", "png", "webp"].includes(foto.format)
    && Number.isInteger(foto.width) && foto.width > 0
    && Number.isInteger(foto.height) && foto.height > 0
    && Number.isInteger(foto.bytes) && foto.bytes > 0 && foto.bytes <= 5 * 1024 * 1024;
}

export function apresentarFoto(foto, trilhaId, contexto = "publico") {
  const prefixo = contexto === "admin" ? "/admin/trilhas" : contexto === "autor" ? "/trilhas/minhas" : "/trilhas";
  return {
    _id: foto._id,
    url: fotoProtegida(foto) ? `${prefixo}/${trilhaId}/fotos/${foto._id}/conteudo` : null,
    width: foto.width,
    height: foto.height,
    storageState: foto.storageState || "legacy_public",
    createdAt: foto.createdAt,
    updatedAt: foto.updatedAt,
  };
}

export function apresentarTrilha(trilha, contexto = "publico") {
  const dados = typeof trilha.toObject === "function" ? trilha.toObject() : { ...trilha };
  // Somente contextos privados explícitos preservam metadados de moderação.
  const privado = contexto === "autor" || contexto === "admin";
  const resposta = privado ? dados : Object.fromEntries(
    CAMPOS_PUBLICOS.filter((campo) => Object.hasOwn(dados, campo)).map((campo) => [campo, dados[campo]]),
  );
  // Não propaga propriedades inesperadas de campos estruturados legados.
  if (!privado && resposta.duracao && typeof resposta.duracao === "object") {
    resposta.duracao = { horas: resposta.duracao.horas, minutos: resposta.duracao.minutos };
  }
  if (!privado && resposta.proprietario && typeof resposta.proprietario === "object") {
    resposta.proprietario = resposta.proprietario._id || resposta.proprietario;
    resposta.proprietario = resposta.proprietario.toString();
  }
  resposta.fotos = (trilha.fotos || []).map((foto) => apresentarFoto(foto, trilha._id, contexto));
  return resposta;
}

export function identidadeLimpeza(foto) {
  return { publicId: foto.publicId, resourceType: foto.resourceType || "image", deliveryType: foto.deliveryType || "upload" };
}
