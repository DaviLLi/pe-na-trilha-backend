import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { cloudinaryDisponivel } from "../config/cloudinary.js";

const LIMITE_FOTO = 5 * 1024 * 1024;
const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITE_FOTO,
    files: 1,
    fields: 0,
    parts: 1,
    fieldNameSize: 50,
    fieldSize: 1024,
    headerPairs: 100,
  },
}).single("imagem");

export function exigirCloudinaryDisponivel(_req, res, next) {
  if (!cloudinaryDisponivel()) {
    return res.status(503).json({ mensagem: "Serviço de imagens indisponível." });
  }

  return next();
}

export function receberFotoPerfil(req, res, next) {
  parser(req, res, (erro) => {
    if (!erro) {
      return next();
    }

    if (erro.name === "MulterError" || erro.code === "LIMIT_FILE_SIZE") {
      return next(erro);
    }

    const erroMultipart = new Error("Requisição multipart inválida.");
    erroMultipart.type = "multipart.parse";
    return next(erroMultipart);
  });
}

export async function validarFotoPerfil(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ mensagem: "Envie uma imagem no campo imagem." });
  }

  try {
    const tipo = await fileTypeFromBuffer(req.file.buffer);
    if (!tipo || !TIPOS_ACEITOS.has(tipo.mime)) {
      return res.status(400).json({
        mensagem: "Formato de imagem inválido. Envie JPEG, PNG ou WebP.",
      });
    }

    req.imagemValidada = req.file.buffer;
    return next();
  } catch (erro) {
    return next(erro);
  }
}
