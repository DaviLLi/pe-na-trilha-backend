export const FOTO_FIELDS = ['_id', 'url', 'publicId', 'assetId', 'resourceType', 'deliveryType', 'version', 'format', 'width', 'height', 'bytes', 'storageState'];
export const idValido = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
export function campo(doc, key) {
  if (!doc || typeof doc !== 'object' || !Object.hasOwn(doc, key)) return { present: false };
  const value = structuredClone(doc[key]);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  return { present: true, type, value };
}
export function categoriaStatus(doc) {
  return !doc || !Object.hasOwn(doc, 'status') ? 'missing' : doc.status === null ? 'null'
    : ['pending', 'approved', 'rejected'].includes(doc.status) ? doc.status : 'invalid';
}
export function extrair(data, fingerprint) {
  const items = [], errors = [], publications = [];
  const fail = (code, publicationRef, publicationPosition) => errors.push({ code, publicationRef, publicationPosition });
  (data.errors || []).forEach(() => fail('SYNTHETIC_SOURCE_ERROR', null, null));
  const occurrences = new Map();
  data.publications.forEach((pub, index) => {
    const valid = pub && typeof pub === 'object' && !Array.isArray(pub);
    const raw = valid ? pub : {};
    const recordRef = fingerprint(['publication-record', index, raw._id]);
    publications.push({ raw, index, recordRef, original: campo({ value: pub }, 'value') });
    if (!valid) { fail('INVALID_PUBLICATION', recordRef, index); return; }
    if (Object.hasOwn(pub, 'fotos') && !Array.isArray(pub.fotos)) { fail('INVALID_PHOTO_ARRAY', recordRef, index); return; }
    (pub.fotos || []).forEach((foto, position) => {
      const validPhoto = foto && typeof foto === 'object' && !Array.isArray(foto);
      const photo = validPhoto ? structuredClone(foto) : {};
      const stable = idValido(pub._id) && idValido(photo._id);
      const base = stable ? fingerprint([pub._id, photo._id]) : fingerprint([pub._id ?? index, position, foto]);
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      items.push({ key: `${base}:${occurrence}`, stable, publication: pub, publicationPosition: index, recordRef,
        position, raw: photo, original: campo({ value: foto }, 'value'),
        fields: Object.fromEntries(FOTO_FIELDS.map((key) => [key, campo(photo, key)])),
        status: campo(pub, 'status'), errors: validPhoto ? [] : ['INVALID_PHOTO'], entityIssues: [] });
    });
  });
  const pubIds = new Map(), photoIds = new Map();
  for (const pub of publications) if (idValido(pub.raw._id)) {
    const id = pub.raw._id.toLowerCase(); pubIds.set(id, (pubIds.get(id) || 0) + 1);
  }
  for (const item of items) if (idValido(item.raw._id)) {
    const id = item.raw._id.toLowerCase(); if (!photoIds.has(id)) photoIds.set(id, []); photoIds.get(id).push(item);
  }
  for (const pub of publications) {
    pub.entityIssues = !idValido(pub.raw._id) ? ['INVALID_PUBLICATION_ID']
      : pubIds.get(pub.raw._id.toLowerCase()) > 1 ? ['DUPLICATE_PUBLICATION_ID'] : [];
  }
  for (const item of items) {
    if (!idValido(item.publication._id)) item.entityIssues.push('INVALID_PUBLICATION_ID');
    if (pubIds.get(typeof item.publication._id === 'string' ? item.publication._id.toLowerCase() : null) > 1) item.entityIssues.push('DUPLICATE_PUBLICATION_ID');
    if (!Object.hasOwn(item.raw, '_id')) item.entityIssues.push('MISSING_PHOTO_ID');
    else if (!idValido(item.raw._id)) item.entityIssues.push('INVALID_PHOTO_ID');
    const same = photoIds.get(typeof item.raw._id === 'string' ? item.raw._id.toLowerCase() : null) || [];
    if (same.filter((other) => other.publicationPosition === item.publicationPosition).length > 1) item.entityIssues.push('DUPLICATE_PHOTO_ID_WITHIN_PUBLICATION');
    if (new Set(same.map((other) => other.publicationPosition)).size > 1) item.entityIssues.push('DUPLICATE_PHOTO_ID_ACROSS_PUBLICATIONS');
    item.stable = item.stable && item.entityIssues.length === 0;
    item.duplicateId = item.entityIssues.some((reason) => reason.startsWith('DUPLICATE'));
  }
  return { items, errors, publications };
}
