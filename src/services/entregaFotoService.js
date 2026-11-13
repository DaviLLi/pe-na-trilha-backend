import https from "node:https";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import cloudinary, { configurarCloudinary } from "../config/cloudinary.js";

export const LIMITE_ENTREGA_BYTES = 8 * 1024 * 1024;
export const VARIANTES = Object.freeze({
  miniatura: { width: 480, height: 360, crop: "limit" },
  detalhe: { width: 1600, height: 1600, crop: "limit" },
});

export function limitarTamanho(limite = LIMITE_ENTREGA_BYTES) {
  let recebido = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      recebido += chunk.length;
      if (recebido > limite) return callback(new Error("Limite de imagem excedido."));
      callback(null, chunk);
    },
  });
}

export function abrirFotoProtegida(foto, variante, signal) {
  signal.throwIfAborted();
  if (!configurarCloudinary()) {
    const erro = new Error("Serviço de imagens indisponível.");
    erro.status = 503;
    throw erro;
  }
  const endereco = new URL(cloudinary.url(foto.publicId, {
    secure: true, type: "authenticated", resource_type: "image", sign_url: true,
    private_cdn: false, secure_distribution: "res.cloudinary.com",
    version: foto.version, format: "webp",
    transformation: [{ ...VARIANTES[variante], quality: "auto", flags: "strip_profile" }],
  }));
  if (endereco.protocol !== "https:" || endereco.hostname !== "res.cloudinary.com" || endereco.port) {
    throw new Error("Origem de imagem inválida.");
  }
  return new Promise((resolve, reject) => {
    const requisicao = https.get(endereco, { signal, headers: { Accept: "image/webp" } }, (resposta) => {
      const tamanho = resposta.headers["content-length"];
      if (resposta.statusCode !== 200 || resposta.headers["content-type"]?.split(";")[0] !== "image/webp"
        || (tamanho !== undefined && (!/^\d+$/.test(tamanho) || Number(tamanho) > LIMITE_ENTREGA_BYTES))) {
        resposta.destroy();
        reject(new Error("Resposta inválida do serviço de imagens."));
        return;
      }
      resolve(resposta);
    });
    requisicao.on("error", reject);
  });
}

// O signal também é enviado ao driver. Esta espera encerra o handler mesmo se
// uma etapa local (como buffering do Mongoose) ainda não observar o cancelamento.
export function esperarComCancelamento(operacao, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abortar = () => reject(signal.reason);
    signal.addEventListener("abort", abortar, { once: true });
    const concluir = (callback, valor) => {
      signal.removeEventListener("abort", abortar);
      callback(valor);
    };
    try {
      Promise.resolve(operacao()).then(
        (valor) => concluir(resolve, valor),
        (erro) => concluir(reject, erro),
      );
    } catch (erro) {
      concluir(reject, erro);
    }
  });
}

// O destino intermediário mantém a resposta HTTP fora da destruição automática
// de pipeline(), permitindo JSON seguro enquanto nenhum header foi enviado.
export async function transmitirFoto(origem, res, signal) {
  const esperaDrain = new AbortController();
  const sinalDrain = AbortSignal.any([signal, esperaDrain.signal]);
  const destino = new Writable({
    write(chunk, encoding, callback) {
      try {
        signal.throwIfAborted();
        if (res.write(chunk, encoding)) return callback();
        once(res, "drain", { signal: sinalDrain }).then(() => callback(), callback);
      } catch (erro) { callback(erro); }
    },
    destroy(erro, callback) {
      esperaDrain.abort();
      callback(erro);
    },
    final(callback) {
      try {
        signal.throwIfAborted();
        res.end(callback);
      } catch (erro) { callback(erro); }
    },
  });
  await pipeline(origem, limitarTamanho(), destino, { signal });
}
