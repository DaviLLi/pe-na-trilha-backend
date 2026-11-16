import { evidenciaUrlPublica } from './cloudinary-reader.js';
import { createHmac } from 'node:crypto';
export function criarPseudonimizador(key) {
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32) throw new Error('PSEUDONYM_KEY_REQUIRED_32_BYTES');
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  }
  return (value) => createHmac('sha256', key).update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
}
export function idSeguro(value) { return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value) ? value : null; }
const enumerados = {
  status: ['pending', 'approved', 'rejected'], deliveryType: ['upload', 'authenticated', 'private'],
  storageState: ['ready', 'legacy_public', 'migration_pending', 'blocked'], resourceType: ['image'], format: ['jpg', 'jpeg', 'png', 'webp'],
};
export function sanitizarCampo(campo, name, fingerprint) {
  if (!campo.present) return { present: false };
  const { value, type } = campo;
  let safe;
  if (value === null) safe = null;
  else if (enumerados[name]?.includes(value)) safe = value;
  else if (['version', 'width', 'height', 'bytes'].includes(name) && typeof value === 'number' && Number.isFinite(value)) safe = value;
  else if (name === '_id' && idSeguro(value)) safe = value;
  else if (name === 'url' && typeof value === 'string') {
    let category = 'invalid';
    try { const url = new URL(value); category = ['http:', 'https:'].includes(url.protocol) ? (url.hostname === 'res.cloudinary.com' ? 'cloudinary' : 'external') : 'unsupported'; } catch { /* sem incluir URL ou erro */ }
    safe = `${category}:${fingerprint(value)}`;
  } else safe = `redacted:${fingerprint(value)}`;
  return { present: true, type, value: safe, ...(name === 'url' ? { deliveryEvidence: evidenciaUrlPublica(value).state, publicIdRef: evidenciaUrlPublica(value).publicId ? fingerprint(evidenciaUrlPublica(value).publicId) : null } : {}), ...(['assetId','publicId'].includes(name) ? { valid: typeof value === 'string' && value.trim().length > 0 } : {}) };
}
