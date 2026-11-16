import { jest } from '@jest/globals';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { criarLeitorMongoSintetico } from '../../tools/photo-inventory/mongo-reader.js';
import { criarLeitorCloudinarySintetico } from '../../tools/photo-inventory/cloudinary-reader.js';
import { gerarRelatorio, validarRelatorio, resumoLegivel } from '../../tools/photo-inventory/report.js';
import { configurar, lerFixture } from '../../tools/photo-inventory/config.js';
const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const key = 'synthetic-third-audit-only-pseudonym-key-12345';
const directories = [];
function base() {
  const d = JSON.parse(fs.readFileSync(join(root, 'catalog.json'), 'utf8'));
  d.publications = [d.publications[0]]; d.assets = [d.assets[0]]; d.users = [d.users[0]]; d.operations = [];
  return d;
}
const run = (d = base()) => gerarRelatorio({ mongo: criarLeitorMongoSintetico(d), cloudinary: criarLeitorCloudinarySintetico(d.assets), pseudonymKey: key,
  now: () => new Date('2026-11-13T12:00:00.000Z'), runId: 'third-audit' });
function publicUrl(d) { d.publications[0].fotos[0].url = `https://res.cloudinary.com/synthetic/image/upload/v1/${d.assets[0].publicId}.webp?token=synthetic-secret`; }
function publicCopy(d) { d.assets.push({ ...d.assets[0], assetId: 'synthetic-public-origin', deliveryType: 'upload' }); }
afterEach(() => {
  jest.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
test('authenticated sem evidência pública é distinguido de revogação comprovada', () => {
  const r = run(), i = r.items[0];
  expect(i.classification.eligibility).toBe('already_protected');
  expect(i.legacyPublicOrigin).toMatchObject({ state: 'none_found', revocation: 'not_proven', publicAssetRefs: [] });
  expect(r.summary.byLegacyPublicOrigin).toEqual({ none_found: 1 });
});
test('URL pública sozinha é suspeita e não comprova que o destino funciona', () => {
  const d = base(); publicUrl(d); const r = run(d), i = r.items[0];
  expect(i.classification.protection).toBe('verified_authenticated');
  expect(i.classification.eligibility).toBe('manual_review');
  expect(i.classification.reasons).toContain('LEGACY_PUBLIC_ORIGIN_SUSPECTED');
  expect(i.legacyPublicOrigin).toMatchObject({ state: 'suspected', catalogState: 'checked', publicAssetRefs: [] });
  expect(JSON.stringify(r) + resumoLegivel(r)).not.toMatch(/synthetic-secret|res.cloudinary.com|foto-101/);
});
test.each([false, true])('cópia pública e authenticated permanecem assets distintos; URL=%s', (url) => {
  const d = base(); publicCopy(d); if (url) publicUrl(d);
  const r = run(d), i = r.items[0];
  expect(i.legacyPublicOrigin.state).toBe('confirmed');
  expect(i.legacyPublicOrigin.publicAssets[0]).toMatchObject({ deliveryType: 'upload', resourceType: 'image' });
  expect(i.legacyPublicOrigin.publicAssetRefs).not.toContain(i.remoteVerification.assetRef);
  expect(i.classification.eligibility).toBe('manual_review');
  expect(i.classification.reasons).toContain('LEGACY_PUBLIC_ORIGIN_CONFIRMED');
  expect(r.summary.uniqueAssetsConfirmed).toBe(1);
  expect(r.summary.duplicateGroups).toBe(0);
});
test('URL com publicId diferente pode confirmar origem separada no catálogo', () => {
  const d = base(); publicCopy(d); d.assets[1].publicId = 'synthetic/old-origin';
  d.publications[0].fotos[0].url = 'https://res.cloudinary.com/synthetic/image/upload/v1/synthetic/old-origin.webp';
  expect(run(d).items[0].legacyPublicOrigin.state).toBe('confirmed');
});
test('URL pública sem correspondência no catálogo continua suspeita', () => {
  const d = base(); d.publications[0].fotos[0].url = 'https://res.cloudinary.com/synthetic/image/upload/old-not-in-catalog.webp';
  expect(run(d).items[0].legacyPublicOrigin.state).toBe('suspected');
});
test.each(['revoked', 'none_found'])('não permite apagar evidência ou declarar origem %s', (state) => {
  const d = base(); publicUrl(d); const r = run(d); r.items[0].legacyPublicOrigin.state = state;
  expect(() => validarRelatorio(r)).toThrow();
});
test('não aceita comprovação inventada de revogação', () => {
  const r = run(); r.items[0].legacyPublicOrigin.revocation = 'proven';
  expect(() => validarRelatorio(r)).toThrow();
});
test('origem ambígua não funde dois assets e bloqueia elegibilidade automática', () => {
  const d = base(); publicCopy(d); d.assets.push({ ...d.assets[1], assetId: 'another-public-origin' });
  const i = run(d).items[0];
  expect(i.legacyPublicOrigin.state).toBe('unknown');
  expect(i.classification.eligibility).toBe('manual_review');
  expect(i.classification.protection).toBe('verified_authenticated');
});
test('identidades divergentes continuam sem candidatura', () => {
  const d = base(); publicCopy(d); d.publications[0].fotos[0].assetId = 'divergent';
  const i = run(d).items[0];
  expect(i.remoteVerification.state).toBe('identity_conflict');
  expect(i.classification.eligibility).toBe('manual_review');
});
test('catálogo indisponível e URLs opacas não comprovam ausência pública', () => {
  const d = base(); d.assets[0].error = true; publicUrl(d);
  expect(run(d).items[0].legacyPublicOrigin.state).toBe('unknown');
  const other = base(); other.publications[0].fotos[0].url = 'https://external.invalid/photo';
  expect(run(other).items[0].classification.eligibility).toBe('manual_review');
});
test('private não equivale a authenticated e origem upload continua candidata se elegível', () => {
  for (const type of ['private', 'upload']) {
    const d = base(); d.assets[0].deliveryType = type; d.publications[0].fotos[0].deliveryType = type;
    d.publications[0].fotos[0].storageState = type === 'upload' ? 'legacy_public' : 'ready';
    const i = run(d).items[0];
    expect(i.classification.protection).toBe(type === 'upload' ? 'public_upload' : 'private_type');
    expect(i.classification.eligibility).toBe(type === 'upload' ? 'migration_candidate' : 'manual_review');
  }
});
test('rejeita referência fantasma com assetRef válido: reprodução exata da auditoria', () => {
  const r = run(); r.items[0].correlationEvidence.push({ kind: 'photo', reference: 'f'.repeat(64) + ':0',
    assetRef: r.items[0].remoteVerification.assetRef, localAliases: [], catalogAliases: [] });
  expect(() => validarRelatorio(r)).toThrow();
});
test('referência existente pertencente a outro asset não integra componente', () => {
  const d = base(), other = structuredClone(d.publications[0]); other._id = '000000000000000000000099';
  other.fotos[0] = { ...other.fotos[0], _id: '000000000000000000000088', assetId: 'other-asset', publicId: 'other-public' };
  d.publications.push(other); d.assets.push({ ...other.fotos[0] });
  const r = run(d); r.items[0].correlationEvidence.push(structuredClone(r.items[1].correlationEvidence[0]));
  expect(() => validarRelatorio(r)).toThrow();
});
test('assetRef e aliases precisam corresponder à foto de origem', () => {
  for (const field of ['assetRef', 'localAliases', 'catalogAliases']) {
    const r = run(); r.items[0].correlationEvidence[0][field] = field === 'assetRef' ? 'f'.repeat(64) : [];
    expect(() => validarRelatorio(r)).toThrow();
  }
});
test.each([999, -1, 0.5])('posição inválida %s é rejeitada', (position) => {
  const r = run(); r.items[0].photoPosition = position; expect(() => validarRelatorio(r)).toThrow();
});
test('posição repetida e troca entre itemKey e registro original são rejeitadas', () => {
  const d = base(); d.publications[0].fotos.push({ _id: '000000000000000000000077' });
  const r = run(d); r.items[1].photoPosition = 0; expect(() => validarRelatorio(r)).toThrow();
  const swapped = run(d); [swapped.items[0].photoPosition, swapped.items[1].photoPosition] = [1, 0];
  expect(() => validarRelatorio(swapped)).toThrow();
});
test('foto sem ID possui posição válida e mantém o vínculo com registro extraído', () => {
  const d = base(); delete d.publications[0].fotos[0]._id;
  const r = run(d); expect(validarRelatorio(r)).toBe(true); expect(r.items[0].photoPosition).toBe(0);
  expect(r.items[0].stableIdentity).toBe(false);
  expect(r.publications[0].photoRecords[0].itemKey).toBe(r.items[0].itemKey);
});
function temporaryFixture() {
  const dir = fs.mkdtempSync(join(root, 'synthetic-open-')); directories.push(dir);
  const path = join(dir, 'fixture.json'); fs.writeFileSync(path, JSON.stringify(base()));
  return { dir, path, config: configurar({ fixture: path, pseudonymKey: key }) };
}
test('leitura usa descritor validado, fecha recurso e não reabre caminho', () => {
  const { config } = temporaryFixture();
  const io = { ...fs, readFileSync: jest.fn(() => { throw new Error('PATH_REOPEN_FORBIDDEN'); }), closeSync: jest.fn(fs.closeSync) };
  expect(lerFixture(config, io)).toEqual(base()); expect(io.readFileSync).not.toHaveBeenCalled(); expect(io.closeSync).toHaveBeenCalledTimes(1);
});
test('symlink existente para fora das fixtures é recusado', () => {
  const { dir } = temporaryFixture(), outside = fs.mkdtempSync(join(tmpdir(), 'synthetic-inventory-')); directories.push(outside);
  const target = join(outside, 'outside.json'); fs.writeFileSync(target, JSON.stringify(base()));
  const link = join(dir, 'link.json'); fs.symlinkSync(target, link);
  expect(() => configurar({ fixture: link, pseudonymKey: key })).toThrow('PATH');
});
test('symlink substituído após validação é recusado por O_NOFOLLOW', () => {
  const { config, path, dir } = temporaryFixture(); fs.renameSync(path, join(dir, 'original.json')); fs.symlinkSync(join(dir, 'original.json'), path);
  expect(() => lerFixture(config)).toThrow();
});
test('arquivo substituído após validação tem identidade diferente e é recusado', () => {
  const { config, path, dir } = temporaryFixture(); fs.renameSync(path, join(dir, 'original.json')); fs.writeFileSync(path, JSON.stringify(base()));
  expect(() => lerFixture(config)).toThrow('FIXTURE_CHANGED');
});
test('substituição após abertura não troca os bytes lidos pelo descritor', () => {
  const { config, path, dir } = temporaryFixture();
  const io = { ...fs, openSync: (...args) => { const fd = fs.openSync(...args); fs.renameSync(path, join(dir, 'original.json')); fs.writeFileSync(path, '{"synthetic":false}'); return fd; } };
  // Rename may change ctime: both rejection and a read of the original inode are safe.
  try { expect(lerFixture(config, io)).toEqual(base()); } catch (error) { expect(error.message).toBe('FIXTURE_CHANGED'); }
});
test('alteração durante leitura é recusada e fecha descritor', () => {
  const { config } = temporaryFixture(); let checks = 0;
  const io = { ...fs, closeSync: jest.fn(fs.closeSync), fstatSync: (fd) => { const stat = fs.fstatSync(fd); if (++checks === 2) stat.mtimeMs++; return stat; } };
  expect(() => lerFixture(config, io)).toThrow('FIXTURE_CHANGED'); expect(io.closeSync).toHaveBeenCalledTimes(1);
});
test('diretórios e tamanho excessivo são recusados pelo descritor', () => {
  for (const change of [(s) => { s.size = 3 * 1024 * 1024; }, (s) => { s.isFile = () => false; }]) {
    const { config } = temporaryFixture();
    const io = { ...fs, fstatSync: (fd) => { const stat = fs.fstatSync(fd); change(stat); return stat; } };
    expect(() => lerFixture(config, io)).toThrow('FIXTURE_CHANGED');
  }
});
test('sem O_NOFOLLOW e caminho externo falham de forma segura', () => {
  const { config } = temporaryFixture();
  expect(() => lerFixture(config, { ...fs, constants: { ...fs.constants, O_NOFOLLOW: 0 } })).toThrow('UNSUPPORTED');
  expect(() => configurar({ fixture: 'package.json', pseudonymKey: key })).toThrow('PATH');
});
test('relatório serializado mantém validade e manifesto independente dos itens', () => {
  const r = run(); expect(validarRelatorio(JSON.parse(JSON.stringify(r)))).toBe(true);
  r.items[0].sourceFields.width.value++;
  expect(r.publications[0].photoRecords[0].sourceFields.width.value).toBe(800);
  expect(() => validarRelatorio(r)).toThrow();
});
test('identidade pública sem vínculo comprovado com item ou URL é rejeitada', () => {
  const d = base(); publicCopy(d); const r = run(d);
  r.items[0].legacyPublicOrigin.publicAssets[0].publicIdRef = 'f'.repeat(64);
  expect(() => validarRelatorio(r)).toThrow('INVALID_PUBLIC_ORIGIN_REFERENCE');
});
