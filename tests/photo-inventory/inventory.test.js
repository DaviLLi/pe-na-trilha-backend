import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { criarLeitorMongoSintetico } from '../../tools/photo-inventory/mongo-reader.js';
import { criarLeitorCloudinarySintetico } from '../../tools/photo-inventory/cloudinary-reader.js';
import { gerarRelatorio, validarRelatorio, resumoLegivel } from '../../tools/photo-inventory/report.js';
import { extrair, campo } from '../../tools/photo-inventory/extract.js';
import { criarPseudonimizador } from '../../tools/photo-inventory/redact.js';
import { configurar } from '../../tools/photo-inventory/config.js';
import { main } from '../../tools/photo-inventory/cli.js';
const fixturePath = fileURLToPath(new URL('./fixtures/catalog.json', import.meta.url));
const key = 'synthetic-key-for-tests-only-123456789';
const load = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
const clock = () => new Date('2026-11-13T12:00:00Z');
function run(fixture = load()) {
  return gerarRelatorio({ mongo: criarLeitorMongoSintetico(fixture), cloudinary: criarLeitorCloudinarySintetico(fixture.assets), pseudonymKey: key, now: clock, runId: 'synthetic-run' });
}
afterEach(() => jest.restoreAllMocks());
test('preserva valores originais na extração, sem defaults nem mutação', () => {
  const data = load(); const original = structuredClone(data);
  const extracted = extrair({ ...data, errors: [] }, criarPseudonimizador(key));
  expect(extracted.items[4].status).toEqual({ present: false });
  expect(extracted.items[6].status).toEqual({ present: true, type: 'null', value: null });
  expect(extracted.items[5].fields.url.value).toContain('synthetic-password');
  expect(extracted.items[6].fields.deliveryType).toEqual({ present: true, type: 'number', value: 42 });
  expect(campo({}, 'status')).toEqual({ present: false });
  expect(data).toEqual(original);
});
test('totais, status persistidos, proteção e elegibilidade', () => {
  const report = run();
  expect(report.summary.publications).toBe(6);
  expect(report.summary.photoReferences).toBe(8);
  expect(report.summary.byPersistedStatus).toEqual({ approved: 1, pending: 1, rejected: 1, missing: 1, null: 1, invalid: 1 });
  expect(report.items[0].classification.eligibility).toBe('already_protected');
  expect(report.items[1].classification.eligibility).toBe('migration_candidate');
  expect(report.items[1].classification.protection).toBe('public_upload');
  expect(report.summary.insufficientIdentification).toBeGreaterThan(0);
  expect(validarRelatorio(report)).toBe(true);
});
test('correlaciona duplicidades, perfis e operações pendentes/falhas', () => {
  const report = run();
  expect(report.items[2].classification.reasons).toEqual(expect.arrayContaining(['PROFILE_CONFLICT','FAILED_OPERATION']));
  expect(report.items[2].classification.eligibility).toBe('blocked');
  expect(report.items[3].classification.reasons).toEqual(expect.arrayContaining(['SHARED_ASSET','PENDING_OPERATION']));
  expect(report.summary.profileConflicts).toBe(1);
  expect(report.summary.relatedPendingOperations).toBe(1);
});
test('IDs de foto duplicados ficam todos instáveis, não só a última ocorrência', () => {
  const data = load(); data.publications[0].fotos.push({ ...data.publications[0].fotos[0] });
  const report = run(data);
  expect(report.items.slice(0,2).every((item) => !item.stableIdentity)).toBe(true);
  expect(new Set(report.items.map((item) => item.itemKey)).size).toBe(report.items.length);
});
test('ready com metadados ausentes não é protegido e divergência remota é inconsistente', () => {
  const data = load(); delete data.publications[0].fotos[0].width;
  data.publications[1].fotos[0].version = 999;
  const report = run(data);
  expect(report.items[0].classification.eligibility).not.toBe('already_protected');
  expect(report.items[0].classification.reasons).toContain('INVALID_READY_STATE');
  expect(report.items[1].classification.integrity).toBe('inconsistent');
});
test('pseudônimos estáveis por chave, independentes da ordem das propriedades', () => {
  const fn = criarPseudonimizador(key);
  expect(fn({ a:1,b:2 })).toBe(fn({ b:2,a:1 }));
  expect(fn('owner')).not.toBe(criarPseudonimizador(key+'outra')('owner'));
  expect(run()).toEqual(run());
});
test('sanitiza URLs, credenciais, proprietários e mensagens de erro', () => {
  const report = run();
  const output = JSON.stringify(report) + resumoLegivel(report);
  for (const secret of ['synthetic-password','synthetic-secret','personal-name','synthetic-owner','private@example','invalid-status-secret','pe-na-trilha/trilhas']) expect(output).not.toContain(secret);
  expect(report.items[5].sourceFields.url.value).toMatch(/^external:/);
});
test('erros de fonte e consultas remotas produzem relatório parcial e erros genéricos', () => {
  const data = load(); data.errors = ['mongodb://secret-user:secret-pass@host']; data.assets[0].error = 'credential-secret';
  const report = run(data);
  expect(report.run.status).toBe('partial');
  expect(report.errors.map((error) => error.code)).toEqual(['SYNTHETIC_SOURCE_ERROR']);
  expect(report.items[0].remoteVerification.state).toBe('error');
  expect(JSON.stringify(report)).not.toMatch(/secret-pass|credential-secret/);
});
test('schema rejeita propriedades extras, tipos incorretos e total incoerente', () => {
  const bad = run(); bad.secret = 'token'; expect(() => validarRelatorio(bad)).toThrow();
  const type = run(); type.summary.publications = '6'; expect(() => validarRelatorio(type)).toThrow();
  const total = run(); total.summary.photoReferences++; expect(() => validarRelatorio(total)).toThrow('TOTALS');
  const external = run(); external.run.externalReadsAuthorized = true; expect(() => validarRelatorio(external)).toThrow();
});
test('não abre conexões externas nem acessa URLs de fixtures', () => {
  const calls = [jest.spyOn(https,'request'),jest.spyOn(https,'get'),jest.spyOn(http,'request'),jest.spyOn(net,'connect'),jest.spyOn(globalThis,'fetch')];
  calls.forEach((call) => call.mockImplementation(() => { throw new Error('NETWORK_FORBIDDEN'); }));
  run(); calls.forEach((call) => expect(call).not.toHaveBeenCalled());
});
test('leitores bloqueiam escrita/conexão e adaptadores não sintéticos são recusados', () => {
  const data = load(); const mongo = criarLeitorMongoSintetico(data); const cloud = criarLeitorCloudinarySintetico(data.assets);
  for (const reader of [mongo,cloud]) {
    expect(() => reader.write()).toThrow('WRITE_DISABLED');
    expect(() => reader.connect()).toThrow('EXTERNAL_ACCESS_DISABLED');
  }
  expect(() => gerarRelatorio({ mongo: { kind:'real' }, cloudinary:cloud, pseudonymKey:key })).toThrow('EXTERNAL');
  expect(() => criarLeitorMongoSintetico({ ...data, synthetic:false })).toThrow('SYNTHETIC');
});
test('CLI offline padrão, saída JSON validada e resumo sem dados sensíveis', () => {
  const out = { write:jest.fn() };
  const env = { PHOTO_INVENTORY_PSEUDONYM_KEY:key, MONGO_URI_PRODUCTION:'proibido', CLOUDINARY_URL:'proibido' };
  expect(main(['--fixture',fixturePath],env,out)).toBe(2);
  const report = JSON.parse(out.write.mock.calls[0][0]); expect(validarRelatorio(report)).toBe(true);
  out.write.mockClear(); main(['--fixture',fixturePath,'--format','text'],env,out);
  expect(out.write.mock.calls[0][0]).toContain('OFFLINE');
});
test.each([['--mode','online'],['--authorize-external','yes'],['--mongo-uri','mongodb://secret'],['--delete','yes']])('CLI bloqueia acesso externo/escrita %j', (...args) => {
  const output = { write:jest.fn() };
  expect(main(args,{ PHOTO_INVENTORY_PSEUDONYM_KEY:key },output)).toBe(1);
  expect(output.write.mock.calls[0][0]).not.toContain('mongodb://');
});
test('config recusa caminhos externos e chave fraca, sem ler credenciais do ambiente', () => {
  expect(() => configurar({ fixture:'package.json', pseudonymKey:key })).toThrow('PATH');
  expect(() => configurar({ fixture:fixturePath, pseudonymKey:'curta' })).toThrow('KEY');
});

test('não conta a mesma duplicidade duas vezes por publicId e assetId', () => {
  expect(run().summary.duplicateGroups).toBe(1);
});
test('operação desconhecida e dono inexistente exigem revisão', () => {
  const data = load(); data.operations.push({ publicId:data.publications[1].fotos[0].publicId, estado:'desconhecido' });
  data.publications[0].proprietario = 'owner-inexistente';
  const report = run(data);
  expect(report.items[0].classification.reasons).toContain('OWNER_NOT_FOUND');
  expect(report.items[1].classification.reasons).toContain('INVALID_OPERATION_STATE');
  expect(report.items[1].classification.eligibility).toBe('manual_review');
});
test('ambiguidade remota produz parcial, nunca protegido', () => {
  const data = load(); data.assets.push({ ...data.assets[0] });
  const report = run(data);
  expect(report.run.status).toBe('partial');
  expect(report.items[0].classification.eligibility).toBe('manual_review');
});
test('documento malformado produz erro parcial sanitizado', () => {
  const data = load(); data.publications.push(null, { fotos:'invalido' });
  const report = run(data);
  expect(report.run.status).toBe('partial');
  expect(report.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['INVALID_PUBLICATION','INVALID_PHOTO_ARRAY']));
});
test('leitor usa snapshot sintético e não altera fixture original', () => {
  const data = load(), mongo = criarLeitorMongoSintetico(data);
  const before = structuredClone(data);
  mongo.read().publications.pop();
  expect(mongo.read().publications).toHaveLength(6);
  expect(data).toEqual(before);
});
test('schema rejeita presença incoerente e chaves arbitrárias no resumo', () => {
  const report = run(); report.items[0].persistedStatus = { present:true };
  expect(() => validarRelatorio(report)).toThrow('PRESENCE');
  const report2 = run(); report2.summary.byPersistedStatus['segredo arbitrário'] = 1;
  expect(() => validarRelatorio(report2)).toThrow('SCHEMA');
});

test('presença do proprietário é distinta para ausente e nulo no relatório', () => {
  const data = load(); delete data.publications[0].proprietario; data.publications[1].proprietario = null;
  const report = run(data);
  expect(report.items[0].publicationFields.proprietario).toEqual({ present:false });
  expect(report.items[1].publicationFields.proprietario).toEqual({ present:true, type:'null', value:null });
});
