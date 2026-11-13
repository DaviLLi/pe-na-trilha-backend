import { pathToFileURL } from 'node:url';
import { configurar, lerFixture } from './config.js';
import { criarLeitorMongoSintetico } from './mongo-reader.js';
import { criarLeitorCloudinarySintetico } from './cloudinary-reader.js';
import { gerarRelatorio, resumoLegivel } from './report.js';
export function main(args = process.argv.slice(2), env = process.env, output = process.stdout) {
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const declared = { '--fixture': 'fixture', '--mode': 'mode', '--format': 'format' };
      if (!Object.hasOwn(declared, args[i])) throw new Error('INVALID_ARGUMENTS');
      const name = declared[args[i]];
      if (!name || !args[i + 1] || Object.hasOwn(options, name)) throw new Error('INVALID_ARGUMENTS');
      options[name] = args[i + 1];
    }
    const config = configurar({ ...options, pseudonymKey: env.PHOTO_INVENTORY_PSEUDONYM_KEY });
    const fixture = lerFixture(config);
    const mongo = criarLeitorMongoSintetico(fixture);
    const cloudinary = criarLeitorCloudinarySintetico(fixture.assets);
    const report = gerarRelatorio({ mongo, cloudinary, pseudonymKey: config.pseudonymKey });
    output.write(config.format === 'text' ? resumoLegivel(report) + '\n' : JSON.stringify(report, null, 2) + '\n');
    return report.run.status === 'partial' ? 2 : 0;
  } catch {
    output.write('Inventário bloqueado: configuração, fixture ou relatório inválido. Nenhum acesso externo permitido.\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
