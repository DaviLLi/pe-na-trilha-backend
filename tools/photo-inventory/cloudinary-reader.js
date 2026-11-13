// Apenas interpreta URLs; nunca consulta o destino.
export function evidenciaUrlPublica(value) {
  if (value === undefined) return { state: 'absent', publicId: null };
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'res.cloudinary.com') return { state: 'unknown', publicId: null };
    const match = url.pathname.match(/^\/[^/]+\/image\/upload\/(?:v[0-9]+\/)?(.+)\.[a-zA-Z0-9]+$/);
    if (!match) return { state: 'unknown', publicId: null };
    return { state: 'public_upload', publicId: decodeURIComponent(match[1]) };
  } catch { return { state: 'unknown', publicId: null }; }
}
export function decidirOrigemPublica({ urlEvidence, catalogState, publicAssetRefs }) {
  if (catalogState === 'ambiguous' || catalogState === 'unavailable') return 'unknown';
  if (publicAssetRefs.length) return 'confirmed';
  if (urlEvidence === 'public_upload') return 'suspected';
  return urlEvidence === 'unknown' ? 'unknown' : 'none_found';
}
export const textoValido = (value) => typeof value === 'string' && value.trim().length > 0;
export function identidadeComposta(asset) {
  return asset?.resourceType === 'image' && ['upload', 'authenticated', 'private'].includes(asset.deliveryType)
    && textoValido(asset.publicId) ? JSON.stringify(['image', asset.deliveryType, asset.publicId]) : null;
}
export function identidade(asset) {
  return textoValido(asset?.assetId) ? `asset:${asset.assetId}` : identidadeComposta(asset);
}
export function criarLeitorCloudinarySintetico(assets) {
  if (!Array.isArray(assets)) throw new Error('INVALID_SYNTHETIC_CATALOG');
  const data = structuredClone(assets);
  const invalidCatalog = data.some((asset) => !textoValido(asset?.assetId) || !identidadeComposta(asset));
  return Object.freeze({
    kind: 'synthetic',
    inspectLegacyOrigin(local, remote) {
      const url = evidenciaUrlPublica(local.url);
      const ids = new Set([local.publicId, remote.state === 'found' ? remote.asset.publicId : null, url.publicId].filter(textoValido));
      const matches = data.filter((asset) => asset.resourceType === 'image' && asset.deliveryType === 'upload' && ids.has(asset.publicId));
      const ambiguous = matches.some((asset) => data.filter((other) => other.assetId === asset.assetId || identidadeComposta(other) === identidadeComposta(asset)).length > 1);
      return { urlEvidence: url.state, catalogState: invalidCatalog || data.some((asset) => ids.has(asset.publicId) && asset.error) ? 'unavailable' : ambiguous ? 'ambiguous' : 'checked',
        publicAssets: matches.map((asset) => ({ assetId: asset.assetId, publicId: asset.publicId, resourceType: asset.resourceType, deliveryType: asset.deliveryType })) };
    },
    lookup(foto) {
      const local = foto || {};
      const provided = (key) => Object.hasOwn(local, key);
      if (['assetId', 'publicId'].some((key) => provided(key) && !textoValido(local[key]))
        || (provided('resourceType') && local.resourceType !== 'image')
        || (provided('deliveryType') && !['upload', 'authenticated', 'private'].includes(local.deliveryType))) return { state: 'invalid_identity' };
      if (!textoValido(local.assetId) && !textoValido(local.publicId)) return { state: 'unidentified' };
      if (invalidCatalog) return { state: 'invalid_catalog' };
      const byAsset = textoValido(local.assetId) ? data.filter((asset) => asset.assetId === local.assetId) : [];
      const byPublic = textoValido(local.publicId) ? data.filter((asset) => asset.publicId === local.publicId
        && (!provided('resourceType') || local.resourceType === asset.resourceType)
        && (!provided('deliveryType') || local.deliveryType === asset.deliveryType)) : [];
      const conflict = (state, a = byAsset, p = byPublic) => ({ state, conflicts: [
        ...a.map((asset) => ({ strategy: 'assetId', assetId: asset.assetId })),
        ...p.map((asset) => ({ strategy: 'publicId', assetId: asset.assetId })),
      ] });
      if (byAsset.length > 1 || byPublic.length > 1) return conflict('ambiguous');
      if (textoValido(local.assetId) && textoValido(local.publicId)
        && (byAsset.length || byPublic.length) && (!byAsset.length || !byPublic.length || byAsset[0] !== byPublic[0])) return conflict('identity_conflict');
      const found = textoValido(local.assetId) ? byAsset[0] : byPublic[0];
      if (!found) return { state: 'not_found' };
      const sameTuple = data.filter((asset) => identidadeComposta(asset) === identidadeComposta(found));
      if (sameTuple.length > 1) return conflict('ambiguous', byAsset, sameTuple);
      if ((provided('resourceType') && local.resourceType !== found.resourceType)
        || (provided('deliveryType') && local.deliveryType !== found.deliveryType)) return conflict('identity_conflict');
      if (found.error) return { state: 'error' };
      return { state: 'found', asset: structuredClone(found) };
    },
    write() { throw new Error('WRITE_DISABLED'); },
    connect() { throw new Error('EXTERNAL_ACCESS_DISABLED'); },
  });
}
