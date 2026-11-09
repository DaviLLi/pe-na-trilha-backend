import { resolveSrv } from "node:dns/promises";
import { isIP } from "node:net";

function normalizarHost(host) {
  const entrada = String(host || "").trim().toLowerCase();
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(entrada);
  if (ipv6) return ipv6[1].replace(/\.$/, "");
  if (isIP(entrada) === 6) return entrada;

  const separadorPorta = entrada.lastIndexOf(":");
  const temPorta = separadorPorta > -1 && /^\d+$/.test(entrada.slice(separadorPorta + 1));
  const nome = temPorta ? entrada.slice(0, separadorPorta) : entrada;
  return nome.replace(/\.$/, "");
}

function exigirHostsPermitidos(hosts, permitidos) {
  const allowlist = new Set(permitidos.map(normalizarHost));
  const naoPermitidos = hosts
    .map(normalizarHost)
    .filter((host) => !host || !allowlist.has(host));

  if (naoPermitidos.length) {
    throw new Error("A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.");
  }
}

export async function validarDestinosSrv(uri, hostsPermitidos, resolver = resolveSrv) {
  const url = new URL(uri);
  if (url.protocol !== "mongodb+srv:") {
    return [];
  }

  let registros;
  try {
    registros = await resolver(`_mongodb._tcp.${url.hostname}`);
  } catch {
    throw new Error("Não foi possível validar os destinos SRV de MongoDB.");
  }

  if (!Array.isArray(registros) || registros.length === 0) {
    throw new Error("A configuração SRV não anunciou destinos MongoDB.");
  }

  const destinos = registros.map((registro) => registro.name);
  exigirHostsPermitidos(destinos, hostsPermitidos);
  return destinos.map(normalizarHost);
}

function ordenarDestinosSrv(destinos) {
  return destinos
    .map(({ name, port }) => `${normalizarHost(name)}:${port}`)
    .sort();
}

export async function validarDestinosSrvEstaveis(uri, hostsPermitidos, resolver = resolveSrv) {
  const url = new URL(uri);
  if (url.protocol !== "mongodb+srv:") return [];

  let primeiro;
  let segundo;
  try {
    primeiro = await resolver(`_mongodb._tcp.${url.hostname}`);
    segundo = await resolver(`_mongodb._tcp.${url.hostname}`);
  } catch {
    throw new Error("Não foi possível confirmar a estabilidade dos destinos SRV MongoDB.");
  }

  if (!Array.isArray(primeiro) || !primeiro.length || !Array.isArray(segundo) || !segundo.length) {
    throw new Error("A configuração SRV não anunciou destinos MongoDB.");
  }

  exigirHostsPermitidos(primeiro.map(({ name }) => name), hostsPermitidos);
  exigirHostsPermitidos(segundo.map(({ name }) => name), hostsPermitidos);
  if (JSON.stringify(ordenarDestinosSrv(primeiro)) !== JSON.stringify(ordenarDestinosSrv(segundo))) {
    throw new Error("Os destinos DNS SRV mudaram durante a validação de pré-conexão.");
  }

  return segundo.map(({ name }) => normalizarHost(name));
}

export function validarMembrosReplicaSet(hello, hostsPermitidos) {
  if (hello?.msg === "isdbgrid") {
    throw new Error("Topologia mongos não é aceita porque seus membros internos não são enumeráveis.");
  }
  if (!hello?.setName) {
    throw new Error("MongoDB de integração não anunciou um replica set.");
  }
  if (!Array.isArray(hello.hosts) || hello.hosts.length === 0) {
    throw new Error("O replica set não anunciou a lista completa de membros.");
  }

  const membros = [
    hello.me,
    ...(hello.hosts || []),
    ...(hello.passives || []),
    ...(hello.arbiters || []),
  ].filter(Boolean);

  exigirHostsPermitidos(membros, hostsPermitidos);
  return membros.map(normalizarHost);
}

export async function verificarTopologiaMongo(db, hostsPermitidos) {
  const hello = await db.admin().command({ hello: 1 });
  validarMembrosReplicaSet(hello, hostsPermitidos);
  return hello;
}

export async function conectarAposValidarSrv(uri, hostsPermitidos, conectar, resolver = resolveSrv) {
  await validarDestinosSrvEstaveis(uri, hostsPermitidos, resolver);
  return conectar();
}

export async function executarAposValidarTopologia(db, hostsPermitidos, operacao) {
  await verificarTopologiaMongo(db, hostsPermitidos);
  return operacao(db);
}
