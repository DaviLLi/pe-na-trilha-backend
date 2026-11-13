// Interface exclusivamente sintética; não importa drivers, models ou bootstrap.
export function criarLeitorMongoSintetico(fixture) {
  if (fixture?.synthetic !== true || fixture.schemaVersion !== '1') throw new Error('SYNTHETIC_FIXTURE_REQUIRED');
  for (const field of ['publications', 'users', 'operations', 'assets']) {
    if (!Array.isArray(fixture[field])) throw new Error('INVALID_FIXTURE');
  }
  if (fixture.errors !== undefined && !Array.isArray(fixture.errors)) throw new Error('INVALID_FIXTURE');
  const data = structuredClone(fixture);
  return Object.freeze({
    kind: 'synthetic',
    read() { return structuredClone({ publications: data.publications, users: data.users, operations: data.operations, errors: data.errors || [] }); },
    write() { throw new Error('WRITE_DISABLED'); },
    connect() { throw new Error('EXTERNAL_ACCESS_DISABLED'); },
  });
}
