import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
const { realpathSync, statSync } = fs;
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
const identity = (stat) => ['dev','ino','size','mtimeMs','ctimeMs'].map((key) => stat[key]);
export const VERSION = '1.2.0-offline';
export function configurar({ mode = 'offline', fixture, format = 'json', pseudonymKey } = {}) {
  if (mode !== 'offline') throw new Error('EXTERNAL_ACCESS_DISABLED');
  if (!['json', 'text'].includes(format)) throw new Error('INVALID_FORMAT');
  if (typeof pseudonymKey !== 'string' || Buffer.byteLength(pseudonymKey) < 32) throw new Error('PSEUDONYM_KEY_REQUIRED_32_BYTES');
  const root = realpathSync(fileURLToPath(new URL('../../tests/photo-inventory/fixtures/', import.meta.url)));
  if (typeof fixture !== 'string' || !fixture.endsWith('.json')) throw new Error('SYNTHETIC_FIXTURE_REQUIRED');
  let path;
  try { path = realpathSync(resolve(fixture)); } catch { throw new Error('INVALID_FIXTURE_PATH'); }
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('INVALID_FIXTURE_PATH');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_FIXTURE_BYTES) throw new Error('INVALID_FIXTURE_PATH');
  return { mode, fixture: path, format, pseudonymKey, fixtureIdentity: identity(stat) };
}

// Read only through the validated descriptor. Parent directories must be trusted:
// Node does not expose openat2/RESOLVE_BENEATH for atomic ancestor validation.
export function lerFixture(config, io = fs) {
  if (!io.constants.O_NOFOLLOW) throw new Error('SAFE_FIXTURE_OPEN_UNSUPPORTED');
  let fd;
  try {
    fd = io.openSync(config.fixture, io.constants.O_RDONLY | io.constants.O_NOFOLLOW | io.constants.O_NONBLOCK);
    const before = io.fstatSync(fd);
    const matches = (stat) => stat.isFile() && stat.size <= MAX_FIXTURE_BYTES
      && JSON.stringify(identity(stat)) === JSON.stringify(config.fixtureIdentity);
    if (!matches(before)) throw new Error('FIXTURE_CHANGED');
    const buffer = Buffer.alloc(MAX_FIXTURE_BYTES + 1);
    let length = 0, bytes;
    do {
      bytes = io.readSync(fd, buffer, length, buffer.length - length, length);
      length += bytes;
    } while (bytes > 0 && length < buffer.length);
    if (length > MAX_FIXTURE_BYTES || length !== before.size || !matches(io.fstatSync(fd))) throw new Error('FIXTURE_CHANGED');
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally {
    if (fd !== undefined) io.closeSync(fd);
  }
}
