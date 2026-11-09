import { randomUUID } from "node:crypto";
import cloudinary, { configurarCloudinary } from "../config/cloudinary.js";

export function criarPublicIdFotoPerfil() {
  return `pe-na-trilha/perfis/${randomUUID()}`;
}

export function enviarImagem(buffer, publicId) {
  if (!configurarCloudinary()) {
    throw new Error("Serviço de imagens indisponível.");
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "image",
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

        resolve({ secureUrl: resultado.secure_url, publicId: resultado.public_id });
      },
    );
    stream.end(buffer);
  });
}

export async function excluirImagem(publicId) {
  if (!configurarCloudinary()) {
    throw new Error("Serviço de imagens indisponível.");
  }

  const resultado = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });

  if (resultado.result !== "ok" && resultado.result !== "not found") {
    throw new Error("O serviço de imagens não confirmou a exclusão.");
  }
}
