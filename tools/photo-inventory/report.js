import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { decidirOrigemPublica } from './cloudinary-reader.js';
import { VERSION } from './config.js';
import { extrair, campo, categoriaStatus } from './extract.js';
import { correlacionar } from './correlate.js';
import { classificar, evidenciaClassificacao, decidir, metadadosCompletos, estadoArmazenamento } from './classify.js';
import { criarPseudonimizador, idSeguro, sanitizarCampo } from './redact.js';
const schema = JSON.parse(readFileSync(new URL('./report.schema.json', import.meta.url), 'utf8'));
const states = ['uploading','cleanup_pending','processing','completed','failed'];
const count = (values) => values.reduce((acc, key) => { acc[key] = (acc[key] || 0) + 1; return acc; }, {});
const sanitizeFields = (raw, names, fn) => Object.fromEntries(names.map((name) => [name, sanitizarCampo(campo(raw, name), name, fn)]));
const metadataNames = ['assetId','publicId','resourceType','deliveryType','version','format','width','height','bytes'];
function summary(report) {
  const { items, publications, errors } = report;
  return {
    publications: publications.length, photoReferences: items.length,
    uniqueAssetsConfirmed: new Set(items.map((item) => item.remoteVerification.assetRef).filter(Boolean)).size,
    byPersistedStatus: count(publications.map((pub) => pub.statusCategory)),
    byLegacyPublicOrigin: count(items.map((item) => item.legacyPublicOrigin.state)),
    byEligibility: count(items.map((item) => item.classification.eligibility)),
    insufficientIdentification: items.filter((item) => !item.evidence.sufficientIdentity).length,
    duplicateGroups: new Set(items.flatMap((item) => item.duplicateGroupRefs)).size,
    profileConflicts: items.filter((item) => item.profileConflictRefs.length).length,
    relatedPendingOperations: new Set(items.flatMap((item) => item.operations.filter((op) => ['uploading','cleanup_pending','processing'].includes(op.state)).map((op) => op.ref))).size,
    manualReviewItems: items.filter((item) => ['blocked','manual_review'].includes(item.classification.eligibility)).length,
    errors: errors.length + items.reduce((total, item) => total + item.errors.length, 0),
  };
}
const partial = (report) => report.errors.length > 0 || report.items.some((item) => item.errors.length > 0);
export function gerarRelatorio({ mongo, cloudinary, pseudonymKey, now = () => new Date(), runId = randomUUID() }) {
  if (mongo?.kind !== 'synthetic' || cloudinary?.kind !== 'synthetic') throw new Error('EXTERNAL_ACCESS_DISABLED');
  const fn = criarPseudonimizador(pseudonymKey), startedAt = now().toISOString();
  const data = mongo.read();
  const extracted = extrair(data, fn);
  const related = correlacionar(extracted.items, data.users, data.operations, fn, cloudinary);
  const items = related.map((item) => {
    const remote = item.remote, evidence = evidenciaClassificacao(item);
    const remoteErrors = ['error','ambiguous','invalid_catalog','identity_conflict'].includes(remote.state) ? [`REMOTE_${remote.state.toUpperCase()}`] : [];
    return {
      itemKey: item.key, stableIdentity: item.stable,
      publicationId: idSeguro(item.publication._id), publicationRef: fn(item.publication._id), publicationRecordRef: item.recordRef,
      photoId: idSeguro(item.raw._id), photoPosition: item.position, ownerRef: fn(item.publication.proprietario),
      originalPhoto: sanitizarCampo(item.original, 'originalPhoto', fn),
      publicationFields: sanitizeFields(item.publication, ['_id','proprietario','status','fotos','createdAt','updatedAt'], fn),
      persistedStatus: sanitizarCampo(item.status, 'status', fn),
      sourceFields: Object.fromEntries(Object.entries(item.fields).map(([name, field]) => [name, sanitizarCampo(field, name, fn)])),
      remoteVerification: { state: remote.state, checkedAt: now().toISOString(), synthetic: true,
        assetRef: remote.state === 'found' ? fn(`asset:${remote.asset.assetId}`) : null,
        conflictEvidence: (remote.conflicts || []).map((ev) => ({ strategy: ev.strategy, ref: fn(`asset:${ev.assetId}`) })),
        fields: remote.state === 'found' ? sanitizeFields(remote.asset, metadataNames, fn) : {},
      },
      legacyPublicOrigin: item.legacyPublicOrigin,
      evidence, identityEvidence: item.identityEvidence, correlationEvidence: item.correlationEvidence,
      classification: classificar(item), duplicateGroupRefs: item.duplicateGroups, profileConflictRefs: item.profileRefs,
      operations: item.relatedOperations.map((op) => ({ ref: op.inventoryRef, state: states.includes(op.estado) ? op.estado : 'invalid' })),
      errors: [...item.errors, ...remoteErrors],
    };
  });
  const publications = extracted.publications.map((pub) => ({
    recordRef: pub.recordRef, position: pub.index, publicationId: idSeguro(pub.raw._id),
    persistedStatus: sanitizarCampo(campo(pub.raw, 'status'), 'status', fn), statusCategory: categoriaStatus(pub.raw),
    fields: sanitizeFields(pub.raw, ['_id','proprietario','status','fotos','createdAt','updatedAt'], fn),
    originalRecord: sanitizarCampo(pub.original, 'originalRecord', fn), entityIssues: pub.entityIssues,
    photoRecords: items.filter((item) => item.publicationRecordRef === pub.recordRef).map((item) => ({ itemKey: item.itemKey, photoPosition: item.photoPosition, originalPhoto: { ...item.originalPhoto }, sourceFields: Object.fromEntries(Object.entries(item.sourceFields).map(([name, field]) => [name, { ...field }])) })),
    extractedPhotos: Array.isArray(pub.raw.fotos) ? pub.raw.fotos.length : 0,
  }));
  const report = {
    schemaVersion: '3', mechanismVersion: VERSION, criteriaVersion: '3',
    run: { id: runId, startedAt, finishedAt: now().toISOString(), status: 'complete', externalReadsAuthorized: false },
    scope: { mode: 'offline', coverage: 'publication_references', consistency: 'synthetic_snapshot' },
    sourceErrors: (data.errors || []).length, publications, ownerRefs: [...new Set(data.users.filter((user) => typeof user?._id === "string" && user._id.trim()).map((user) => fn(user._id)))].sort(), items, errors: extracted.errors,
  };
  report.run.status = partial(report) ? 'partial' : 'complete';
  report.summary = summary(report);
  validarRelatorio(report);
  return report;
}
const fail = (code = 'INVALID_REPORT_SEMANTICS') => { throw new Error(code); };
const same = (a,b) => { if (!isDeepStrictEqual(a,b)) fail(); };
function fieldCategory(field) {
  return !field.present ? 'missing' : field.type === 'null' && field.value === null ? 'null' : field.type === 'string' && ['pending','approved','rejected'].includes(field.value) ? field.value : 'invalid';
}
export function validarRelatorio(report) {
  function check(value, rule) {
    if (Object.keys(rule).some((key) => !['$schema','definitions','$ref','type','enum','minimum','pattern','properties','required','additionalProperties','items'].includes(key))) fail('UNSUPPORTED_SCHEMA_KEYWORD');
    if (rule.$ref) return check(value, schema.definitions[rule.$ref.split('/').pop()]);
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if ((!types.includes(type) && !(types.includes('integer') && Number.isSafeInteger(value))) || (type === 'number' && !Number.isFinite(value))) fail('INVALID_REPORT_SCHEMA');
    if (rule.enum && !rule.enum.includes(value)) fail('INVALID_REPORT_SCHEMA');
    if (rule.minimum !== undefined && value < rule.minimum) fail('INVALID_REPORT_SCHEMA');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('INVALID_REPORT_SCHEMA');
    if (type === 'object') {
      for (const name of rule.required || []) if (!Object.hasOwn(value,name)) fail('INVALID_REPORT_SCHEMA');
      for (const [name,child] of Object.entries(value)) {
        const next = Object.hasOwn(rule.properties || {}, name) ? rule.properties[name] : rule.additionalProperties;
        if (!next || next === false) fail('INVALID_REPORT_SCHEMA');
        check(child,next);
      }
    }
    if (type === 'array') value.forEach((child) => check(child,rule.items));
  }
  check(report,schema);
  const allFields = [...report.publications.flatMap((pub) => [pub.persistedStatus,pub.originalRecord,...Object.values(pub.fields)]), ...report.items.flatMap((item) => [item.originalPhoto,item.persistedStatus,...Object.values(item.sourceFields),...Object.values(item.publicationFields),...Object.values(item.remoteVerification.fields)])];
  for (const field of allFields) if (field.present ? (!Object.hasOwn(field,'type') || !Object.hasOwn(field,'value')) : Object.keys(field).length !== 1) fail('INVALID_FIELD_PRESENCE');
  const date = (value) => { const ms = Date.parse(value); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail('INVALID_REPORT_DATE'); return ms; };
  const start = date(report.run.startedAt), end = date(report.run.finishedAt);
  if (end < start) fail('INVALID_REPORT_DATE');
  const unique = (values) => { if (new Set(values).size !== values.length) fail('DUPLICATE_REPORT_REFERENCE'); };
  unique(report.ownerRefs);
  unique(report.items.map((item) => item.itemKey)); unique(report.publications.map((pub) => pub.recordRef));
  const pubs = new Map(report.publications.map((pub) => [pub.recordRef,pub]));
  const fields = [];
  const validId = (value) => value === null || /^[a-f0-9]{24}$/i.test(value);
  const valueOf = (field) => field?.present ? field.value : undefined;
  const meta = (fields) => Object.fromEntries(metadataNames.map((name) => [name,
    ['assetId','publicId'].includes(name) ? (fields[name]?.valid && fields[name]?.type === 'string' ? valueOf(fields[name]) : undefined)
      : fields[name]?.type === (['version','width','height','bytes'].includes(name) ? 'number' : 'string') ? valueOf(fields[name]) : undefined,
  ]));
  const idOf = (field) => field?.type === 'string' && /^[a-f0-9]{24}$/i.test(field.value) ? field.value : null;
  for (const pub of report.publications) {
    if (!validId(pub.publicationId)) fail();
    same(pub.statusCategory,fieldCategory(pub.persistedStatus));
    const issues = pub.publicationId === null ? ['INVALID_PUBLICATION_ID'] : report.publications.filter((other) => other.publicationId?.toLowerCase() === pub.publicationId.toLowerCase()).length > 1 ? ['DUPLICATE_PUBLICATION_ID'] : [];
    same(pub.entityIssues,issues);
    same(pub.persistedStatus,pub.fields.status); same(pub.publicationId,idOf(pub.fields._id));
    fields.push(pub.persistedStatus);
  }
  unique(report.publications.map((pub) => pub.position));
  for (const item of report.items) {
    const pub = pubs.get(item.publicationRecordRef); if (!pub) fail();
    if (!Number.isSafeInteger(item.photoPosition) || item.photoPosition < 0 || item.photoPosition >= pub.extractedPhotos) fail('INVALID_PHOTO_POSITION');
    const sourceRecord = pub.photoRecords[item.photoPosition];
    if (!sourceRecord) fail('INVALID_PHOTO_POSITION');
    same(sourceRecord, { itemKey: item.itemKey, photoPosition: item.photoPosition, originalPhoto: item.originalPhoto, sourceFields: item.sourceFields });
    same(item.publicationId,pub.publicationId); same(item.persistedStatus,pub.persistedStatus);
    same(item.publicationFields,pub.fields);
    if (!validId(item.photoId)) fail();
    same(item.photoId,idOf(item.sourceFields._id));
    same(item.publicationId,idOf(item.publicationFields._id));
    same(item.publicationFields.status,item.persistedStatus);
    const local = meta(item.sourceFields), remote = meta(item.remoteVerification.fields);
    same(item.evidence.ownerExists,item.publicationFields.proprietario.type === "string" && report.ownerRefs.includes(item.ownerRef));
    same(item.evidence.localComplete,metadadosCompletos(local));
    same(item.evidence.remoteComplete,item.remoteVerification.state === 'found' && metadadosCompletos(remote));
    same(item.evidence.localType,['upload','authenticated','private'].includes(local.deliveryType) ? local.deliveryType : null);
    same(item.evidence.remoteType,item.remoteVerification.state === 'found' ? remote.deliveryType : null);
    same(item.evidence.sufficientIdentity,!!(item.sourceFields.assetId.valid || item.sourceFields.publicId.valid));
    same(item.evidence.storage,!item.sourceFields.storageState.present ? 'missing' : item.sourceFields.storageState.type === 'null' ? 'null' : item.sourceFields.storageState.type !== 'string' ? 'invalid_type' : estadoArmazenamento({ storageState: valueOf(item.sourceFields.storageState) }));
    const mismatch = item.remoteVerification.state === 'found' ? metadataNames.filter((key) => item.sourceFields[key].present &&
      (item.sourceFields[key].value !== item.remoteVerification.fields[key]?.value || item.sourceFields[key].type !== item.remoteVerification.fields[key]?.type)) : [];
    same(item.evidence.mismatchFields,mismatch);
    const issues = [];
    if (!item.publicationId) issues.push('INVALID_PUBLICATION_ID');
    if (item.publicationId && report.publications.filter((other) => other.publicationId?.toLowerCase() === item.publicationId.toLowerCase()).length > 1) issues.push('DUPLICATE_PUBLICATION_ID');
    if (!item.sourceFields._id.present) issues.push('MISSING_PHOTO_ID');
    else if (!item.photoId) issues.push('INVALID_PHOTO_ID');
    if (item.photoId) {
      const samePhoto = report.items.filter((other) => other.photoId?.toLowerCase() === item.photoId.toLowerCase());
      if (samePhoto.filter((other) => other.publicationRecordRef === item.publicationRecordRef).length > 1) issues.push('DUPLICATE_PHOTO_ID_WITHIN_PUBLICATION');
      if (new Set(samePhoto.map((other) => other.publicationRecordRef)).size > 1) issues.push('DUPLICATE_PHOTO_ID_ACROSS_PUBLICATIONS');
    }
    same(item.evidence.entityIssues,issues);
    const checked = date(item.remoteVerification.checkedAt); if (checked < start || checked > end) fail('INVALID_REPORT_DATE');
    if ((item.remoteVerification.state === 'found') !== (item.remoteVerification.assetRef !== null)) fail();
    if (item.remoteVerification.assetRef !== null && !item.identityEvidence.some((ev) => ev.origin === 'synthetic_catalog' && ev.strategy === 'assetId' && ev.ref === item.remoteVerification.assetRef)) fail();
    if (item.remoteVerification.assetRef !== null && !/^[a-f0-9]{64}$/.test(item.remoteVerification.assetRef)) fail();
    if (item.remoteVerification.state !== 'found' && Object.keys(item.remoteVerification.fields).length) fail();
    if (['ambiguous','identity_conflict'].includes(item.remoteVerification.state) !== (item.remoteVerification.conflictEvidence.length > 0)) fail();
    if (item.evidence.status !== (pub.statusCategory === 'missing' ? 'missing' : ['pending','approved','rejected'].includes(pub.statusCategory) ? pub.statusCategory : 'invalid')) fail();
    same(item.evidence.malformed, item.originalPhoto.type !== 'object');
    same(item.stableIdentity, item.evidence.entityIssues.length === 0);
    const origin = item.legacyPublicOrigin;
    if (origin.revocation !== 'not_proven' || origin.state === 'revoked') fail('UNPROVEN_REVOCATION');
    unique(origin.publicAssetRefs);
    same(origin.publicAssetRefs, [...new Set(origin.publicAssets.map((asset) => asset.assetRef))].sort());
    const publicIds = [item.sourceFields.publicId.value, item.remoteVerification.fields.publicId?.value]
      .filter((value) => typeof value === 'string' && value.startsWith('redacted:')).map((value) => value.slice('redacted:'.length));
    if (item.sourceFields.url.publicIdRef) publicIds.push(item.sourceFields.url.publicIdRef);
    for (const asset of origin.publicAssets) if (!publicIds.includes(asset.publicIdRef)) fail('INVALID_PUBLIC_ORIGIN_REFERENCE');
    same(origin.urlEvidence, item.sourceFields.url.present ? item.sourceFields.url.deliveryEvidence : 'absent');
    same(origin.state, decidirOrigemPublica(origin));
    if (item.remoteVerification.state === 'found' && item.evidence.remoteType === 'upload' && origin.catalogState === 'checked' && !origin.publicAssetRefs.includes(item.remoteVerification.assetRef)) fail();
    unique(item.correlationEvidence.map((ev) => ev.reference));
    same(item.profileConflictRefs,[...item.correlationEvidence.filter((ev) => ev.kind === 'profile').map((ev) => ev.reference)].sort());
    same(item.operations.map((op) => op.ref).sort(),item.correlationEvidence.filter((ev) => ev.kind === 'operation').map((ev) => ev.reference).sort());
    if (!item.correlationEvidence.some((ev) => ev.kind === 'photo' && ev.reference === item.itemKey)) fail();
    if (item.remoteVerification.assetRef && item.correlationEvidence.some((ev) => ev.assetRef !== item.remoteVerification.assetRef)) fail();
    for (const ev of item.correlationEvidence) if (ev.assetRef !== null && !/^[a-f0-9]{64}$/.test(ev.assetRef)) fail();
    unique(item.duplicateGroupRefs); unique(item.profileConflictRefs); unique(item.operations.map((op) => op.ref));
    const expected = decidir(item.evidence,item.remoteVerification.state, { legacyPublicOrigin: origin, shared: !!item.duplicateGroupRefs.length, profile: !!item.profileConflictRefs.length, operationStates: item.operations.map((op) => op.state) });
    same(item.classification,expected);
    const assetRef = item.remoteVerification.assetRef;
    const related = assetRef ? report.items.filter((other) => other.remoteVerification.assetRef === assetRef) : [item];
    const photoEvidence = item.correlationEvidence.filter((ev) => ev.kind === 'photo');
    same(photoEvidence.map((ev) => ev.reference).sort(), related.map((other) => other.itemKey).sort());
    for (const ev of photoEvidence) {
      const target = report.items.find((other) => other.itemKey === ev.reference);
      if (!target || ev.assetRef !== target.remoteVerification.assetRef) fail('INVALID_PHOTO_REFERENCE');
      same(ev.localAliases, target.identityEvidence.filter((identity) => identity.origin === 'local').map((identity) => identity.ref));
      same(ev.catalogAliases, target.identityEvidence.filter((identity) => identity.origin === 'synthetic_catalog').map((identity) => identity.ref));
    }
    if (related.length > 1) {
      if (item.duplicateGroupRefs.length !== 1 || related.some((other) => other.duplicateGroupRefs[0] !== item.duplicateGroupRefs[0])) fail();
      for (const other of related) same(item.correlationEvidence,other.correlationEvidence);
    } else if (item.duplicateGroupRefs.length) fail();
    const errors = [...(item.evidence.malformed ? ['INVALID_PHOTO'] : []), ...(['error','ambiguous','invalid_catalog','identity_conflict'].includes(item.remoteVerification.state) ? [`REMOTE_${item.remoteVerification.state.toUpperCase()}`] : [])];
    same(item.errors,errors);
    fields.push(item.originalPhoto,item.persistedStatus,...Object.values(item.sourceFields),...Object.values(item.publicationFields),...Object.values(item.remoteVerification.fields));
  }
  for (const field of fields) if (field.present ? (!Object.hasOwn(field,'type') || !Object.hasOwn(field,'value')) : Object.keys(field).length !== 1) fail('INVALID_FIELD_PRESENCE');
  if (report.sourceErrors > report.errors.length) fail();
  const expectedErrors = Array.from({ length: report.sourceErrors }, () => ({ code: 'SYNTHETIC_SOURCE_ERROR', publicationRef: null, publicationPosition: null }));
  for (const pub of report.publications) {
    same(pub.photoRecords.length,pub.extractedPhotos);
    pub.photoRecords.forEach((record, index) => same(record.photoPosition,index));
    unique(pub.photoRecords.map((record) => record.itemKey));
    unique(report.items.filter((item) => item.publicationRecordRef === pub.recordRef).map((item) => item.photoPosition));
    same(pub.extractedPhotos,report.items.filter((item) => item.publicationRecordRef === pub.recordRef).length);
    const code = pub.originalRecord.type !== 'object' ? 'INVALID_PUBLICATION'
      : pub.fields.fotos.present && pub.fields.fotos.type !== 'array' ? 'INVALID_PHOTO_ARRAY' : null;
    if (code) expectedErrors.push({ code, publicationRef: pub.recordRef, publicationPosition: pub.position });
  }
  same(report.errors,expectedErrors);
  for (const error of report.errors) {
    if (error.publicationRef !== null && pubs.get(error.publicationRef)?.position !== error.publicationPosition) fail();
    if ((error.publicationRef === null) !== (error.publicationPosition === null)) fail();
  }
  same(report.run.status,partial(report) ? 'partial' : 'complete');
  if (!isDeepStrictEqual(report.summary,summary(report))) fail('INVALID_REPORT_TOTALS');
  return true;
}
export function resumoLegivel(report) {
  validarRelatorio(report); const s = report.summary;
  return [`Inventário OFFLINE — dados sintéticos — ${report.run.status}`, `Publicações: ${s.publications}; fotos: ${s.photoReferences}`,
    `Status: ${JSON.stringify(s.byPersistedStatus)}`, `Elegibilidade: ${JSON.stringify(s.byEligibility)}`, `Origem pública antiga: ${JSON.stringify(s.byLegacyPublicOrigin)}`,
    `Sem identificação: ${s.insufficientIdentification}; grupos duplicados: ${s.duplicateGroups}; conflitos de perfil: ${s.profileConflicts}`,
    `Operações pendentes: ${s.relatedPendingOperations}; revisão manual: ${s.manualReviewItems}; erros: ${s.errors}`].join('\n');
}
