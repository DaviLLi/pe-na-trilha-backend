export const HOST_ATLAS_PRODUCAO = "penatrilhaproducao.squuj5c.mongodb.net";
export const HOST_ATLAS_TESTES = "pe-na-trilha-testes.vcnkitn.mongodb.net";
export const BANCO_HOMOLOGACAO = "pe_na_trilha_homologacao";

export function normalizarHostMongo(host) {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function pertenceAoAtlas(host, seed) {
  return host.endsWith(seed.slice(seed.indexOf(".")));
}

export function alteraDestinoMongo(url) {
  return [...url.searchParams.keys()].some((chave) =>
    ["proxyhost", "srvservicename", "dbname"].includes(chave.toLowerCase()));
}

export function lerUriMongo(uri, variavel) {
  try {
    const url = new URL(uri);
    if (["mongodb:", "mongodb+srv:"].includes(url.protocol) && url.hostname) return url;
  } catch {
    // Não deixe o erro do parser expor a URI.
  }
  throw new Error(`A variável ${variavel} precisa ser um URI MongoDB válido.`);
}
