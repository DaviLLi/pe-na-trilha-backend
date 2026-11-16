// TEMPORÁRIO: remover este módulo e sua chamada após diagnosticar o 403.
// Opt-in: CLOUDINARY_DIAGNOSTICO_403=1. Observa uma tentativa por processo.
import https from "node:https";
import { diagnosticarFalhaUpload } from "./diagnosticoUpload.js";

const MAX_CORPO_BYTES = 8192;
const MAX_TEXTO_LOG = 256;

function textoSeguro(texto) {
  const seguro = diagnosticarFalhaUpload({ message: texto }).mensagemOriginal;
  return seguro?.slice(0, MAX_TEXTO_LOG);
}

function corpoSeguro(buffer, tipo) {
  const texto = buffer.toString("utf8");
  // Mesmo que um intermediário rotule um eco de multipart como texto, não o loga.
  if (/multipart\/form-data|content-disposition\s*:|boundary\s*=|data:[^,]*;base64|-----BEGIN/i.test(texto)) return undefined;
  if (tipo === "application/json" || tipo.endsWith("+json")) {
    let json;
    try { json = JSON.parse(texto); } catch { return undefined; }
    // Não serializa o corpo JSON completo: ele pode conter arquivo ou autenticação.
    return textoSeguro(typeof json?.error === "string" ? json.error : json?.error?.message ?? json?.message);
  }
  // HTML pode incluir scripts, dados de formulários e atributos sensíveis.
  const limpo = tipo === "text/html" ? texto
    .replace(/<(script|style|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, " ") : texto;
  return textoSeguro(limpo);
}

function observar403(resposta, registrar) {
  if (resposta.statusCode !== 403) return;
  const dados = { statusHttp: 403 };
  const headers = resposta.headers || {};
  const header = Object.keys(headers).find((chave) => chave.toLowerCase() === "x-cld-error");
  const cldError = header ? textoSeguro(headers[header]) : undefined;
  if (cldError) dados.cldError = cldError;
  const tipo = typeof headers["content-type"] === "string" ? headers["content-type"].split(";")[0].trim().toLowerCase() : "";
  const encoding = headers["content-encoding"];
  const permitido = (!encoding || encoding === "identity") &&
    (["application/json", "text/plain", "text/html"].includes(tipo) || /^application\/[a-z0-9.-]+\+json$/.test(tipo));
  let partes = [], tamanho = 0, excedeu = false, concluido = false;
  function concluir(estado) {
    if (concluido) return;
    concluido = true;
    try {
      if (permitido && !excedeu && estado === "completo" && tamanho) {
        const corpo = corpoSeguro(Buffer.concat(partes), tipo);
        if (corpo) dados.corpoOriginal = corpo;
      }
      dados.corpoEstado = !permitido ? "omitido_tipo_ou_codificacao" : excedeu ? "omitido_limite" : !tamanho ? "ausente" : dados.corpoOriginal ? "sanitizado" : "omitido_ou_incompleto";
      // O logger recebe somente dados novos, primitivos e limitados; nunca a resposta.
      registrar("[TEMP Cloudinary 403 — remover após diagnóstico]", dados);
    } catch { /* A instrumentação não pode afetar o resultado do SDK. */ }
    partes = [];
  }
  // O SDK ignora corpo de 403. Drená-lo permite diagnóstico sem substituir,
  // atrasar ou consumir o callback original. Nunca há acesso ao request/multipart.
  resposta.on("data", (chunk) => {
    if (!permitido || excedeu || concluido) return;
    tamanho += chunk.length;
    if (tamanho > MAX_CORPO_BYTES) { excedeu = true; partes = []; return; }
    partes.push(Buffer.from(chunk));
  });
  resposta.once("end", () => concluir("completo"));
  resposta.once("aborted", () => concluir("interrompido"));
  resposta.once("error", () => concluir("interrompido"));
  resposta.once("close", () => concluir("interrompido"));
}

export function criarDiagnosticoUpload403({ habilitado = () => process.env.CLOUDINARY_DIAGNOSTICO_403 === "1", registrar = (...args) => console.error(...args) } = {}) {
  let utilizado = false;
  return function instrumentar(executar) {
    if (utilizado || !habilitado()) return executar();
    utilizado = true;
    const original = https.request;
    // Cloudinary 2.11.0 cria o request sincronamente dentro de upload_stream.
    // Interceptação só nesta pilha síncrona; restaura antes de enviar o arquivo.
    // Nenhuma troca de agent/proxy/TLS e nenhum patch persistente em node_modules.
    function observarRequest(...args) {
      const opcoes = args[0];
      const indice = args.length - 1;
      const callback = args[indice];
      if (opcoes?.method === "POST" && /\/image\/upload$/.test(opcoes.pathname || opcoes.path || "") && typeof callback === "function") {
        args[indice] = function receberResposta(resposta) {
          try { observar403(resposta, registrar); } catch { /* Preserva o SDK. */ }
          return callback.apply(this, arguments);
        };
      }
      return Reflect.apply(original, this, args);
    }
    https.request = observarRequest;
    try { return executar(); } finally { https.request = original; }
  };
}

export const diagnosticarUpload403Temporariamente = criarDiagnosticoUpload403();
