import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { criarLeitorMongoSintetico } from '../../tools/photo-inventory/mongo-reader.js';
import { criarLeitorCloudinarySintetico } from '../../tools/photo-inventory/cloudinary-reader.js';
import { gerarRelatorio, validarRelatorio } from '../../tools/photo-inventory/report.js';
import { extrair } from '../../tools/photo-inventory/extract.js';
import { criarPseudonimizador } from '../../tools/photo-inventory/redact.js';
import { main } from '../../tools/photo-inventory/cli.js';
const path = fileURLToPath(new URL('./fixtures/catalog.json', import.meta.url));
const key = 'synthetic-audit-regressions-only-12345678';
function base() {
  const d = JSON.parse(readFileSync(path,'utf8'));
  d.publications = [d.publications[1]]; d.assets = [d.assets[1]]; d.users = [d.users[0]]; d.operations = [];
  return d;
}
function run(data = base()) {
  return gerarRelatorio({ mongo: criarLeitorMongoSintetico(data), cloudinary: criarLeitorCloudinarySintetico(data.assets), pseudonymKey:key,
    now: () => new Date('2026-11-13T12:00:00.000Z'), runId:'audit-regression' });
}
const clone = structuredClone;
test('achado alto: identifica mesmo asset por assetId e publicId complementares', () => {
  const d = base(), full = d.publications[0].fotos[0];
  d.publications[0].fotos = [{ _id:full._id, assetId:full.assetId, storageState:'legacy_public' },
    { _id:'000000000000000000000099', publicId:full.publicId, storageState:'legacy_public' }];
  const r = run(d);
  expect(r.summary.uniqueAssetsConfirmed).toBe(1);
  expect(r.summary.duplicateGroups).toBe(1);
  for (const item of r.items) {
    expect(item.classification.eligibility).toBe('manual_review');
    expect(item.classification.reasons).toContain('SHARED_ASSET');
    expect(item.identityEvidence.some((ev) => ev.origin === 'synthetic_catalog')).toBe(true);
  }
});
test('achado alto: conflito transitivo com perfil e operação por outro identificador', () => {
  const d=base(), full=d.publications[0].fotos[0];
  d.publications[0].fotos=[{ _id:full._id, assetId:full.assetId, storageState:'legacy_public' }];
  d.users.push({_id:'synthetic-profile',fotoPerfilPublicId:full.publicId});
  d.operations.push({_id:'synthetic-operation',publicId:full.publicId,estado:'cleanup_pending'});
  const r=run(d), item=r.items[0];
  expect(item.classification.eligibility).toBe('blocked');
  expect(item.classification.reasons).toEqual(expect.arrayContaining(['PROFILE_CONFLICT','PENDING_OPERATION']));
  expect(r.summary.profileConflicts).toBe(1);
  expect(r.summary.relatedPendingOperations).toBe(1);
  expect(item.correlationEvidence.map((ev)=>ev.kind).sort()).toEqual(['operation','photo','profile']);
});
test('M1: null === null nunca identifica asset remoto', () => {
  expect(criarLeitorCloudinarySintetico([{deliveryType:'authenticated'}]).lookup({assetId:'inexistente'}).state).toBe('invalid_catalog');
});
test.each([{},null,{assetId:null},{assetId:''},{publicId:null},{resourceType:'image',deliveryType:'upload'}])('identidade ausente ou incompleta %j não corresponde', (local) => {
  expect(criarLeitorCloudinarySintetico(base().assets).lookup(local).state).not.toBe('found');
});
test('catálogo com identidade incompleta não comprova proteção', () => {
  const d=base(); delete d.assets[0].assetId;
  const r=run(d);
  expect(r.items[0].remoteVerification.state).toBe('invalid_catalog');
  expect(r.items[0].classification.protection).toBe('unverified');
  expect(r.items[0].classification.eligibility).toBe('manual_review');
});
test('assetId divergente não faz fallback para publicId e preserva conflito', () => {
  const d=base(); d.publications[0].fotos[0].assetId='nao-corresponde';
  const r=run(d);
  expect(r.items[0].remoteVerification.state).toBe('identity_conflict');
  expect(r.items[0].classification.reasons).toContain('REMOTE_IDENTITY_CONFLICT');
});
test('identidade composta divergente não corresponde pelo assetId apenas', () => {
  const d=base(); d.publications[0].fotos[0].deliveryType='private';
  expect(run(d).items[0].remoteVerification.state).toBe('identity_conflict');
});
test('tipo private é distinguido sem candidatura automática', () => {
  const d=base(); d.assets[0].deliveryType='private'; d.publications[0].fotos[0].deliveryType='private';
  const item=run(d).items[0];
  expect(item.classification.protection).toBe('private_type');
  expect(item.classification.eligibility).toBe('manual_review');
});
test('M2: publicações duplicadas não são origens estáveis, mesmo com fotos diferentes', () => {
  const d=base(), other=clone(d.publications[0]);
  other.fotos=[{...other.fotos[0],_id:'000000000000000000000088',assetId:'other',publicId:'other'}];
  d.publications.push(other); d.assets.push(clone(other.fotos[0]));
  const r=run(d);
  for(const item of r.items) {
    expect(item.stableIdentity).toBe(false);
    expect(item.classification.reasons).toContain('DUPLICATE_PUBLICATION_ID');
    expect(item.classification.reasons).not.toContain('DUPLICATE_PHOTO_ID_WITHIN_PUBLICATION');
    expect(item.classification.eligibility).toBe('manual_review');
  }
});
test.each(['within','across'])('duplicidade de foto %s é separada da duplicidade de publicação', (kind) => {
  const d=base();
  if(kind==='within') d.publications[0].fotos.push(clone(d.publications[0].fotos[0]));
  else d.publications.push({...clone(d.publications[0]),_id:'000000000000000000000033'});
  const r=run(d), reason=kind==='within'?'DUPLICATE_PHOTO_ID_WITHIN_PUBLICATION':'DUPLICATE_PHOTO_ID_ACROSS_PUBLICATIONS';
  for(const item of r.items) {
    expect(item.classification.reasons).toContain(reason);
    expect(item.classification.reasons).not.toContain('DUPLICATE_PUBLICATION_ID');
  }
});
test.each([undefined,null,42,{},'invalid'])('ID ausente/nulo/inválido %j exige revisão', (id) => {
  const d=base(); if(id===undefined) delete d.publications[0].fotos[0]._id; else d.publications[0].fotos[0]._id=id;
  const item=run(d).items[0];expect(item.stableIdentity).toBe(false);expect(item.classification.eligibility).toBe('manual_review');
});
test.each([
  [undefined,'STORAGE_STATE_MISSING'],[null,'STORAGE_STATE_NULL'],[42,'STORAGE_STATE_INVALID_TYPE'],[false,'STORAGE_STATE_INVALID_TYPE'],['unexpected','STORAGE_STATE_UNKNOWN'],
])('M3: estado inválido/ausente %j não permite candidatura', (state, reason) => {
  const d=base(); if(state===undefined) delete d.publications[0].fotos[0].storageState; else d.publications[0].fotos[0].storageState=state;
  const item=run(d).items[0]; expect(item.classification.reasons).toContain(reason);expect(item.classification.eligibility).toBe('manual_review');
});
test.each(['blocked','migration_pending'])('estado conhecido %s bloqueia', (state) => {
  const d=base();d.publications[0].fotos[0].storageState=state;expect(run(d).items[0].classification.eligibility).toBe('blocked');
});
test('ready incompatível é recusado; ready autenticado completo é protegido', () => {
  const d=base();d.publications[0].fotos[0].storageState='ready';
  expect(run(d).items[0].classification.reasons).toContain('INVALID_READY_STATE');
  d.publications[0].fotos[0].deliveryType='authenticated';d.assets[0].deliveryType='authenticated';
  expect(run(d).items[0].classification.eligibility).toBe('already_protected');
});
test.each([
  (r)=>{r.run.startedAt='not-a-date';},
  (r)=>{r.run.finishedAt='2020-01-01T00:00:00.000Z';},
  (r)=>{r.items[0].remoteVerification.checkedAt='2099-01-01T00:00:00.000Z';},
  (r)=>{r.summary.uniqueAssetsConfirmed=999;},
  (r)=>{r.summary.profileConflicts=999;},
  (r)=>{r.summary.relatedPendingOperations=999;},
  (r)=>{r.summary.errors=999;},
  (r)=>{r.summary.byEligibility={already_protected:1};},
  (r)=>{r.items[0].classification.eligibility='already_protected';r.summary.byEligibility={already_protected:1};},
  (r)=>{r.run.status='partial';},
  (r)=>{r.items[0].ownerRef='not-a-hmac';},
  (r)=>{r.items.push(clone(r.items[0]));},
  (r)=>{r.items[0].evidence.localComplete=false;},
])('M4: relatório manipulado é rejeitado (%#)', (change) => {
  const r=run();change(r);expect(()=>validarRelatorio(r)).toThrow();
});
test('complete com erro é rejeitado, mesmo se total de erros for atualizado', () => {
  const r=run();r.errors.push({code:'SYNTHETIC_SOURCE_ERROR',publicationRef:null,publicationPosition:null});r.summary.errors++;
  expect(()=>validarRelatorio(r)).toThrow();
});
test('referência compartilhada não pode ser reclassificada como única', () => {
  const d=base();d.publications[0].fotos.push({...clone(d.publications[0].fotos[0]),_id:'000000000000000000000088'});
  const r=run(d);r.items[0].duplicateGroupRefs=[];r.items[0].classification.references='unique';
  expect(()=>validarRelatorio(r)).toThrow();
});
test.each(['constructor','toString','__proto__','hasOwnProperty','valueOf','--constructor'])('M5: CLI rejeita propriedade herdada %s', (arg) => {
  const output={write:jest.fn()};
  expect(main(['--fixture',path,arg,'ignored'],{PHOTO_INVENTORY_PSEUDONYM_KEY:key},output)).toBe(1);
  expect(output.write.mock.calls[0][0]).not.toContain('schemaVersion');
});
test.each([null,'secret-password',42,false,[]])('B1: foto malformada %j mantém tipo e representação original sem vazamento', (value) => {
  const d=base();d.publications[0].fotos=[value];
  const extracted=extrair({...d,errors:[]},criarPseudonimizador(key));
  expect(extracted.items[0].original.value).toEqual(value);
  const r=run(d);expect(r.items[0].originalPhoto.type).toBe(value===null?'null':Array.isArray(value)?'array':typeof value);
  expect(JSON.stringify(r)).not.toContain('secret-password');
});
test('B2: erros globais apontam publicação e posição sem conteúdo sensível', () => {
  const d=base();d.publications[0].fotos='https://user:password@example.invalid?token=secret';
  const r=run(d);expect(r.run.status).toBe('partial');
  expect(r.errors[0]).toEqual({code:'INVALID_PHOTO_ARRAY',publicationPosition:0,publicationRef:r.publications[0].recordRef});
  expect(JSON.stringify(r)).not.toMatch(/password|example.invalid|token=secret/);
});

test('assetId único com identidade composta duplicada no catálogo continua ambíguo', () => {
  const d=base(), foto=d.publications[0].fotos[0];
  d.assets.push({...clone(d.assets[0]),assetId:'outro-id-mesma-identidade'});
  d.publications[0].fotos=[{_id:foto._id,assetId:foto.assetId,storageState:'legacy_public'}];
  expect(run(d).items[0].remoteVerification.state).toBe('ambiguous');
});
test('nomes semelhantes ou identidade composta incompleta não unem assets', () => {
  const d=base(), other=clone(d.publications[0]);
  other._id='000000000000000000000033';other.fotos=[{...clone(other.fotos[0]),_id:'000000000000000000000044',assetId:'outro',publicId:other.fotos[0].publicId+'-similar'}];
  d.publications.push(other);d.assets.push(clone(other.fotos[0]));
  expect(run(d).summary.duplicateGroups).toBe(0);
});
test('remover conflito de perfil sem remover a evidência é rejeitado', () => {
  const d=base();d.users.push({_id:'synthetic-profile',fotoPerfilPublicId:d.assets[0].publicId});
  const r=run(d);r.items[0].profileConflictRefs=[];
  expect(()=>validarRelatorio(r)).toThrow();
});
test('URL externa não é usada como prova de identidade e não cria candidatura', () => {
  const d=base();d.publications[0].fotos=[{_id:'000000000000000000000055',url:'https://example.invalid/secret?token=password',storageState:'legacy_public'}];
  const r=run(d);expect(r.items[0].remoteVerification.state).toBe('unidentified');
  expect(r.items[0].classification.eligibility).toBe('manual_review');
  expect(JSON.stringify(r)).not.toMatch(/example.invalid|token=password/);
});

test('duplicidade de publicação sem fotos permanece rastreável', () => {
  const d=base();d.publications[0].fotos=[];d.publications.push(clone(d.publications[0]));
  const r=run(d);
  expect(r.items).toHaveLength(0);
  expect(r.publications.every((pub)=>pub.entityIssues.includes('DUPLICATE_PUBLICATION_ID'))).toBe(true);
});
test('divergência de identificadores preserva origem da evidência sem identificadores brutos', () => {
  const d=base();d.publications[0].fotos[0].assetId='divergente';
  const r=run(d);
  expect(r.items[0].remoteVerification.conflictEvidence).toEqual([{strategy:'publicId',ref:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
  expect(JSON.stringify(r)).not.toContain('divergente');
});

test('apagar erros de cobertura não transforma leitura parcial em completa', () => {
  const d=base();d.publications[0].fotos='malformado';
  const r=run(d);r.errors=[];r.summary.errors=0;r.run.status='complete';
  expect(()=>validarRelatorio(r)).toThrow();
});
test('retirar item e ajustar totais não oculta referência extraída', () => {
  const r=run();r.items=[];r.summary.photoReferences=0;r.summary.byEligibility={};r.summary.uniqueAssetsConfirmed=0;
  expect(()=>validarRelatorio(r)).toThrow();
});
