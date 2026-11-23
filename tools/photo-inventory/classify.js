import { textoValido } from './cloudinary-reader.js';
export function metadadosCompletos(foto) {
  return textoValido(foto?.assetId) && textoValido(foto?.publicId) && foto.resourceType === 'image'
    && ['upload', 'authenticated', 'private'].includes(foto.deliveryType)
    && Number.isSafeInteger(foto.version) && foto.version > 0 && ['jpg', 'jpeg', 'png', 'webp'].includes(foto.format)
    && ['width', 'height', 'bytes'].every((key) => Number.isSafeInteger(foto[key]) && foto[key] > 0);
}
export function estadoArmazenamento(foto) {
  if (!Object.hasOwn(foto, 'storageState')) return 'missing';
  if (foto.storageState === null) return 'null';
  if (typeof foto.storageState !== 'string') return 'invalid_type';
  return ['ready', 'legacy_public', 'migration_pending', 'blocked'].includes(foto.storageState) ? foto.storageState : 'unknown';
}
export function evidenciaClassificacao(item) {
  const remote = item.remote;
  const mismatchFields = remote.state === 'found' ? ['assetId', 'publicId', 'resourceType', 'deliveryType', 'version', 'format', 'width', 'height', 'bytes']
    .filter((key) => Object.hasOwn(item.raw, key) && item.raw[key] !== remote.asset[key]) : [];
  return {
    localComplete: metadadosCompletos(item.raw), remoteComplete: remote.state === 'found' && metadadosCompletos(remote.asset),
    remoteType: remote.state === 'found' ? remote.asset.deliveryType : null,
    localType: ['upload', 'authenticated', 'private'].includes(item.raw.deliveryType) ? item.raw.deliveryType : null,
    storage: estadoArmazenamento(item.raw), mismatchFields,
    status: !item.status.present ? 'missing' : ['pending','approved','rejected'].includes(item.status.value) ? item.status.value : 'invalid',
    ownerExists: item.ownerExists && textoValido(item.publication.proprietario),
    entityIssues: item.entityIssues, malformed: item.errors.includes('INVALID_PHOTO'),
    ambiguous: item.ambiguous,
    sufficientIdentity: textoValido(item.raw.assetId) || textoValido(item.raw.publicId),
  };
}
// Mesma decisão determinística usada na geração e na validação semântica.
export function decidir(e, remoteState, { shared, profile, operationStates, legacyPublicOrigin }) {
  const reasons = [];
  if (!e.localComplete) reasons.push('INCOMPLETE_METADATA');
  if (e.malformed) reasons.push('INVALID_PHOTO');
  if (remoteState !== 'found') reasons.push(`REMOTE_${remoteState.toUpperCase()}`);
  if (remoteState === 'found' && !e.remoteComplete) reasons.push('INVALID_REMOTE_METADATA');
  if (e.mismatchFields.length) reasons.push('REMOTE_MISMATCH');
  if (e.status === 'missing') reasons.push('MISSING_PERSISTED_STATUS');
  if (e.status === 'invalid') reasons.push('INVALID_STATUS');
  if (!e.ownerExists) reasons.push('OWNER_NOT_FOUND');
  reasons.push(...e.entityIssues);
  if (e.entityIssues.length) reasons.push('UNSTABLE_OR_DUPLICATE_ID');
  if (shared) reasons.push('SHARED_ASSET');
  if (profile) reasons.push('PROFILE_CONFLICT');
  if (e.ambiguous) reasons.push('UNPROVEN_REFERENCE');
  if (operationStates.some((state) => ['uploading','processing','cleanup_pending'].includes(state))) reasons.push('PENDING_OPERATION');
  if (operationStates.includes('failed')) reasons.push('FAILED_OPERATION');
  if (operationStates.includes('invalid')) reasons.push('INVALID_OPERATION_STATE');
  if (['missing','null','unknown','invalid_type'].includes(e.storage)) reasons.push(`STORAGE_STATE_${e.storage.toUpperCase()}`);
  if (['blocked','migration_pending'].includes(e.storage)) reasons.push('STORAGE_BLOCKED');
  const incompatible = (e.storage === 'ready' && (e.localType !== 'authenticated' || !e.localComplete || (remoteState === 'found' && e.remoteType !== 'authenticated')))
    || (e.storage === 'legacy_public' && ((e.localType && e.localType !== 'upload') || (remoteState === 'found' && e.remoteType !== 'upload')));
  if (incompatible) reasons.push(e.storage === 'ready' ? 'INVALID_READY_STATE' : 'INCOMPATIBLE_STORAGE_STATE');
  const protection = remoteState === 'found' && e.remoteComplete && !e.mismatchFields.length
    ? ({ authenticated:'verified_authenticated', upload:'public_upload', private:'private_type' })[e.remoteType] : 'unverified';
  const integrity = incompatible || e.mismatchFields.length || ['unknown','invalid_type','null'].includes(e.storage) ? 'inconsistent' : e.localComplete ? 'complete' : 'incomplete';
  if (e.remoteType === 'authenticated' && legacyPublicOrigin?.state !== 'none_found') reasons.push(`LEGACY_PUBLIC_ORIGIN_${(legacyPublicOrigin?.state || 'unknown').toUpperCase()}`);
  const blockers = reasons.filter((reason) => reason !== 'INCOMPLETE_METADATA');
  let eligibility = 'manual_review';
  if (!blockers.length && protection === 'verified_authenticated' && e.localComplete && e.storage === 'ready') eligibility = 'already_protected';
  if (!blockers.length && protection === 'public_upload' && e.storage === 'legacy_public') eligibility = 'migration_candidate';
  if (reasons.some((reason) => ['PROFILE_CONFLICT','PENDING_OPERATION','STORAGE_BLOCKED'].includes(reason))) eligibility = 'blocked';
  return { protection, integrity, references: profile ? 'profile_conflict' : shared ? 'shared_publications' : e.ambiguous ? 'ambiguous' : 'unique', eligibility, reasons };
}
export function classificar(item) {
  const evidence = evidenciaClassificacao(item);
  return decidir(evidence, item.remote.state, { legacyPublicOrigin: item.legacyPublicOrigin, shared: !!item.duplicateGroups.length, profile: !!item.profileRefs.length,
    operationStates: item.relatedOperations.map((op) => ['uploading','processing','cleanup_pending','failed','completed'].includes(op.estado) ? op.estado : 'invalid') });
}
