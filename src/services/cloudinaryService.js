import { diagnosticarUpload403Temporariamente } from "./diagnosticoUpload403Temporario.js";
import { erroRespostaUploadInvalida } from "./diagnosticoUpload.js";
import { fotoProtegida, FORMATO_VARIANTES, VARIANTES } from "../domain/fotoPublicacao.js";
import {
  PASTA_HOMOLOGACAO,
  apresentarUrlFotoPerfil,
  escopoImagensHomologacao,
  validarImagemDaHomologacao,
  validarModoPastaHomologacao,
} from "../domain/identidadeImagem.js";
import { randomUUID } from "node:crypto";
import cloudinary, { configurarCloudinary } from "../config/cloudinary.js";

function prefixoImagens() {
  return escopoImagensHomologacao() ?? "pe-na-trilha";
}

export function criarPublicIdFotoPerfil() {
  return `${prefixoImagens()}/perfis/${randomUUID()}`;
}

export function criarPublicIdFotoTrilha(trilhaId) {
  return `${prefixoImagens()}/trilhas/${trilhaId}/${randomUUID()}`;
}

export function enviarImagem(buffer, publicId, { deliveryType = "upload" } = {}) {
  validarImagemDaHomologacao(publicId);
  const escopo = escopoImagensHomologacao();
  let destino = { public_id: publicId };
  if (escopo) {
    const modo = validarModoPastaHomologacao(process.env.HOMOLOGATION_CLOUDINARY_FOLDER_MODE);
    destino = modo === "dynamic"
      ? { ...destino, asset_folder: PASTA_HOMOLOGACAO, use_asset_folder_as_public_id_prefix: false }
      : { public_id: publicId.slice(PASTA_HOMOLOGACAO.length + 1), folder: PASTA_HOMOLOGACAO };
  }
  if (!configurarCloudinary()) {
    throw new Error("Serviço de imagens indisponível.");
  }

  return new Promise((resolve, reject) => {
    const criarStream = () => cloudinary.uploader.upload_stream(
      {
        ...destino,
        resource_type: "image",
        ...(deliveryType === "authenticated" ? {
          type: "authenticated",
          eager: Object.values(VARIANTES).map((variante) => ({ ...variante, format: FORMATO_VARIANTES })),
          eager_async: false,
        } : {}),
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        overwrite: false,
        timeout: 120000,
      },
      (erro, resultado) => {
        if (erro) {
          reject(erro);
          return;
        }

        if (!resultado?.secure_url || resultado.public_id !== publicId
          || (destino.asset_folder && resultado.asset_folder !== undefined && resultado.asset_folder !== destino.asset_folder)) {
          reject(erroRespostaUploadInvalida());
          return;
        }

        if (deliveryType === "authenticated") {
          const foto = {
            assetId: resultado.asset_id, publicId: resultado.public_id,
            resourceType: resultado.resource_type, deliveryType: resultado.type,
            version: resultado.version, format: resultado.format,
            width: resultado.width, height: resultado.height, bytes: resultado.bytes,
            storageState: "ready",
          };
          if (!fotoProtegida(foto)) {
            reject(erroRespostaUploadInvalida());
            return;
          }
          resolve(foto);
          return;
        }
        const secureUrl = apresentarUrlFotoPerfil(resultado.secure_url, publicId);
        if (!secureUrl) {
          reject(erroRespostaUploadInvalida());
          return;
        }
        resolve({ secureUrl, publicId: resultado.public_id });
      },
    );
    const stream = deliveryType === "authenticated"
      ? diagnosticarUpload403Temporariamente(criarStream)
      : criarStream();
    stream.end(buffer);
  });
}

export async function excluirImagem(publicId, { resourceType = "image", deliveryType = "upload" } = {}) {
  validarImagemDaHomologacao(publicId);
  if (!configurarCloudinary()) {
    throw new Error("Serviço de imagens indisponível.");
  }

  const resultado = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    ...(deliveryType !== "upload" ? { type: deliveryType } : {}),
    invalidate: true,
    timeout: 120000,
  });

  if (resultado.result !== "ok" && resultado.result !== "not found") {
    throw new Error("O serviço de imagens não confirmou a exclusão.");
  }
}
