import { fotoProtegida } from "../domain/fotoPublicacao.js";
import { randomUUID } from "node:crypto";
import cloudinary, { configurarCloudinary } from "../config/cloudinary.js";

export function criarPublicIdFotoPerfil() {
  return `pe-na-trilha/perfis/${randomUUID()}`;
}

export function criarPublicIdFotoTrilha(trilhaId) {
  return `pe-na-trilha/trilhas/${trilhaId}/${randomUUID()}`;
}

export function enviarImagem(buffer, publicId, { deliveryType = "upload" } = {}) {
  if (!configurarCloudinary()) {
    throw new Error("Serviço de imagens indisponível.");
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "image",
        ...(deliveryType === "authenticated" ? { type: "authenticated" } : {}),
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        overwrite: false,
        timeout: 120000,
      },
      (erro, resultado) => {
        if (erro) {
          reject(erro);
          return;
        }

        if (!resultado?.secure_url || !resultado.public_id) {
          reject(new Error("Resposta inválida do serviço de imagens."));
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
          if (foto.publicId !== publicId || !fotoProtegida(foto)) {
            reject(new Error("Resposta inválida do serviço de imagens."));
            return;
          }
          resolve(foto);
          return;
        }
        resolve({ secureUrl: resultado.secure_url, publicId: resultado.public_id });
      },
    );
    stream.end(buffer);
  });
}

export async function excluirImagem(publicId, { resourceType = "image", deliveryType = "upload" } = {}) {
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
