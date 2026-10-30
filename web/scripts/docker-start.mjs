import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const configPath = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.d1_databases[0].migrations_dir = '../../drizzle';
writeFileSync(configPath, JSON.stringify(config));
const runtime = {};
for (const key of ['CALC_CONVERTER_URL', 'CALC_CONVERTER_TOKEN']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
  runtime[key] = process.env[key];
}
// Wrangler reads secrets from this untracked runtime-only file, never from the build.
writeFileSync('dist/server/.dev.vars', Object.entries(runtime).map(([key, value]) => `${key}=${JSON.stringify(value)}\n`).join(''), { mode: 0o600 });
const wrangler = './node_modules/wrangler/bin/wrangler.js';
const common = ['--config', configPath, '--persist-to', '/data'];
const migration = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', ...common], { stdio: 'inherit' });
if (migration.status !== 0) process.exit(migration.status ?? 1);
const server = spawn(process.execPath, [wrangler, 'dev', '--local', ...common, '--ip', '0.0.0.0', '--port', '8788', '--inspector-port', '0'], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 1));
