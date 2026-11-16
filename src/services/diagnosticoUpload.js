// Só permite campos de diagnóstico explícitos; nunca serializa objetos do SDK.
// A classificação fixa é preservada e o texto original passa por redação antes do log.
const CODIGOS_REDE = new Set([
  "ETIMEDOUT", "ECONNABORTED", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND",
  "EAI_AGAIN", "EPIPE", "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED",
]);
const RESPOSTA_INVALIDA = "CLOUDINARY_INVALID_UPLOAD_RESPONSE";

export function erroRespostaUploadInvalida() {
  const erro = new Error("Resposta inválida do serviço de imagens.");
  erro.code = RESPOSTA_INVALIDA;
  return erro;
}

function sanitizarTexto(valor, fontes, ler) {
  if (typeof valor !== "string" || !valor.trim() || valor.length > 8192) return undefined;
  let texto = valor;
  const sensiveis = [process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET,
    process.env.JWT_SECRET, process.env.CSRF_SECRET];
  for (const fonte of fontes) {
    for (const campo of ["api_key", "api_secret", "token", "signature", "authorization"]) {
      sensiveis.push(ler(fonte, campo));
    }
  }
  for (const segredo of sensiveis) {
    if (typeof segredo !== "string" || !segredo) continue;
    for (const forma of [segredo, encodeURIComponent(segredo)]) texto = texto.split(forma).join("[redigido]");
  }
  texto = texto
    .replace(/(?:https?:\/\/|cloudinary:\/\/|mongodb(?:\+srv)?:\/\/|data:|blob:|www\.)[^\s<>]+/gi, "[redigido]")
    .replace(/(?:api[ _-]?(?:key|secret)|access[ _-]?token|refresh[ _-]?token|token|signature|authorization|password|secret)\s*(?:[:=]\s*|\s+)(?:["'][^"']*["']|[^\s,;]+)/gi, "[redigido]")
    .replace(/(?:Basic|Bearer)\s+[^\s,;]+/gi, "[redigido]")
    .replace(/["'`][^"'`]*["'`]/g, (trecho) => /^(?:authenticated|upload|private|image|jpg|jpeg|png|webp)$/i.test(trecho.slice(1, -1)) ? trecho : "[redigido]")
    .replace(/\b[^\s]*[_=@/?&\\][^\s]*|\b[a-z0-9+/-]{24,}={0,2}|\b\d{6,}\b/gi, "[redigido]")
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ").trim();
  if (!texto.replaceAll("[redigido]", "").trim()) return undefined;
  return texto.slice(0, 1024);
}

export function diagnosticarFalhaUpload(erro) {
  const diagnostico = {};
  // Admin API/ping pode rejeitar { request_options, query_params, error };
  // uploader também pode rejeitar o erro direto. Lemos somente campos próprios
  // de dados, sem percorrer requests, executar getters ou serializar o SDK.
  const ler = (objeto, chave) => {
    if (!objeto || (typeof objeto !== "object" && typeof objeto !== "function")) return undefined;
    try { return Object.getOwnPropertyDescriptor(objeto, chave)?.value; } catch { return undefined; }
  };
  const interno = ler(erro, "error");
  const fontes = interno && typeof interno === "object" && interno !== erro ? [interno, erro] : [erro];
  const codigo = fontes.map((fonte) => ler(fonte, "code"))
    .find((valor) => valor === RESPOSTA_INVALIDA || CODIGOS_REDE.has(valor));
  const status = fontes.flatMap((fonte) => [ler(fonte, "http_code"), ler(fonte, "statusCode"), ler(fonte, "status")])
    .find((valor) => Number.isInteger(valor) && valor >= 400 && valor <= 599);
  if (codigo !== undefined) diagnostico.codigo = codigo;
  if (status !== undefined) diagnostico.statusHttp = status;

  const mensagem = fontes.map((fonte) => ler(fonte, "message"))
    .find((valor) => typeof valor === "string" && valor.trim());
  const texto = typeof mensagem === "string" ? mensagem.slice(0, 4096).toLowerCase() : "";
  if (codigo === RESPOSTA_INVALIDA) {
    diagnostico.mensagem = "Falha na validação local da resposta de upload do Cloudinary.";
  } else if (CODIGOS_REDE.has(codigo)) {
    diagnostico.mensagem = "Falha de comunicação com o Cloudinary (rede, TLS ou timeout).";
  } else if (/invalid.*(?:api.?key|signature|secret|cloud.?name)|unknown.*(?:api.?key|cloud.?name)/.test(texto)
    || status === 401) {
    diagnostico.mensagem = "Cloudinary recusou as credenciais ou a identificação da conta.";
  } else if (status === 403) {
    diagnostico.mensagem = "Cloudinary recusou a operação por permissão ou restrição da conta.";
  } else if (/quota|rate limit|too many requests/.test(texto) || status === 429) {
    diagnostico.mensagem = "Cloudinary informou um limite de uso ou de requisições.";
  } else if (/timeout|timed out|network|socket|certificate|enotfound/.test(texto)) {
    diagnostico.mensagem = "Falha de comunicação com o Cloudinary (rede, TLS ou timeout).";
  } else {
    diagnostico.mensagem = "Falha no envio ao Cloudinary; causa não identificada pelo diagnóstico seguro.";
  }
  if (codigo !== RESPOSTA_INVALIDA) {
    const original = sanitizarTexto(mensagem, fontes, ler);
    if (original) diagnostico.mensagemOriginal = original;
  }
  // Lê exclusivamente o cabeçalho solicitado de respostas, nunca headers de request.
  for (const fonte of fontes) {
    const resposta = ler(fonte, "response");
    for (const headers of [ler(fonte, "headers"), ler(resposta, "headers")]) {
      let chaves;
      try { chaves = headers && typeof headers === "object" ? Object.getOwnPropertyNames(headers) : []; } catch { chaves = []; }
      const chave = chaves.find((nome) => nome.toLowerCase() === "x-cld-error");
      const texto = chave ? sanitizarTexto(ler(headers, chave), fontes, ler) : undefined;
      if (texto && !diagnostico.cldError) diagnostico.cldError = texto;
    }
  }
  return diagnostico;
}
