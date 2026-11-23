import { identidadeComposta, textoValido, decidirOrigemPublica } from './cloudinary-reader.js';
function aliases(local) {
  return [textoValido(local?.assetId) ? `asset:${local.assetId}` : null, identidadeComposta(local)].filter(Boolean);
}
// Todas as entidades são resolvidas antes de construir os componentes de identidade.
export function correlacionar(items, users, operations, fingerprint, reader) {
  const resolve = (local) => { try { return reader.lookup(local); } catch { return { state: 'error' }; } };
  const nodes = [
    ...items.map((item) => ({ type: 'photo', ref: item.key, local: item.raw, item })),
    ...users.filter((user) => user && typeof user === 'object').map((user, index) => ({ type: 'profile', ref: fingerprint(['profile', user._id, index]), local: { ...(Object.hasOwn(user, 'fotoPerfilPublicId') ? { publicId: user.fotoPerfilPublicId } : {}), ...(Object.hasOwn(user, 'fotoPerfil') ? { url: user.fotoPerfil } : {}) } })),
    ...operations.filter((op) => op && typeof op === 'object').map((op, index) => ({ type: 'operation', ref: fingerprint(['operation', op._id, index]), local: op, operation: op })),
  ];
  for (const node of nodes) {
    node.remote = resolve(node.local);
    node.aliases = aliases(node.local);
    if (node.remote.state === 'found') node.aliases.push(...aliases(node.remote.asset));
  }
  // Um alias completo é comparável; aliases incompletos nunca unem componentes.
  const parents = nodes.map((_, index) => index);
  const root = (i) => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const known = new Map();
  nodes.forEach((node, index) => {
    if (node.remote.state !== 'found') return;
    for (const alias of node.aliases) {
      if (known.has(alias)) parents[root(index)] = root(known.get(alias)); else known.set(alias, index);
    }
  });
  return nodes.filter((node) => node.type === 'photo').map((node) => {
    const group = nodes.filter((_, index) => root(index) === root(nodes.indexOf(node)));
    // Referências não resolvidas que poderiam se referir ao mesmo asset bloqueiam
    // automação, mas não são apresentadas como identidade confirmada.
    const ambiguous = nodes.some((other) => other !== node && other.remote.state !== 'found' && (
      node.aliases.some((alias) => other.aliases.includes(alias))
      || (textoValido(node.local.publicId) && node.local.publicId === other.local.publicId)
      || (textoValido(node.local.url) && node.local.url === other.local.url)
      || (node.remote.state === 'found' && node.remote.asset.publicId === other.local.publicId)
    ));
    const photos = group.filter((other) => other.type === 'photo').map((other) => other.ref).sort();
    let origin;
    try { origin = reader.inspectLegacyOrigin(node.local, node.remote); }
    catch { origin = { urlEvidence: Object.hasOwn(node.local, 'url') ? 'unknown' : 'absent', catalogState: 'unavailable', publicAssets: [] }; }
    const legacyPublicOrigin = { urlEvidence: origin.urlEvidence, catalogState: origin.catalogState,
      publicAssets: origin.publicAssets.map((asset) => ({ assetRef: fingerprint(`asset:${asset.assetId}`), publicIdRef: fingerprint(asset.publicId), resourceType: asset.resourceType, deliveryType: asset.deliveryType })).sort((a,b) => a.assetRef.localeCompare(b.assetRef)),
      publicAssetRefs: [...new Set(origin.publicAssets.map((asset) => fingerprint(`asset:${asset.assetId}`)))].sort(), revocation: 'not_proven' };
    legacyPublicOrigin.state = decidirOrigemPublica(legacyPublicOrigin);
    return { ...node.item, remote: node.remote, legacyPublicOrigin,
      ownerExists: users.some((user) => user?._id === node.item.publication.proprietario),
      duplicateGroups: photos.length > 1 ? [fingerprint(photos)] : [],
      profileRefs: group.filter((other) => other.type === 'profile').map((other) => other.ref).sort(),
      relatedOperations: group.filter((other) => other.type === 'operation').map((other) => ({ ...other.operation, inventoryRef: other.ref })),
      ambiguous,
      correlationEvidence: group.map((other) => ({
        kind: other.type, reference: other.ref,
        assetRef: other.remote.state === 'found' ? fingerprint(`asset:${other.remote.asset.assetId}`) : null,
        localAliases: aliases(other.local).map(fingerprint),
        catalogAliases: other.remote.state === 'found' ? aliases(other.remote.asset).map(fingerprint) : [],
      })).sort((a,b) => a.reference.localeCompare(b.reference)),
      identityEvidence: [
        ...aliases(node.local).map((alias) => ({ origin: 'local', strategy: alias.startsWith('asset:') ? 'assetId' : 'compound', ref: fingerprint(alias) })),
        ...(node.remote.state === 'found' ? aliases(node.remote.asset).map((alias) => ({ origin: 'synthetic_catalog', strategy: alias.startsWith('asset:') ? 'assetId' : 'compound', ref: fingerprint(alias) })) : []),
      ],
    };
  });
}
