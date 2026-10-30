import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('local setup generates private credentials and never replaces them', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'peercalc-setup-'));
  try {
    const script = fileURLToPath(new URL('./configure-local.mjs', import.meta.url));
    assert.equal(spawnSync(process.execPath, [script], { cwd }).status, 0);
    const file = join(cwd, '.env');
    const content = readFileSync(file, 'utf8');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const values = Object.fromEntries(content.trim().split('\n').map(line => line.split('=')));
    assert.equal(Buffer.from(values.PEERCALC_COOKIE_SECRET, 'base64url').length, 32);
    assert.equal(values.CALC_CONVERTER_TOKEN.length, 64);
    assert.notEqual(values.PEERCALC_OWNER_PASSWORD, values.PEERCALC_ADMIN_PASSWORD);
    assert.equal(spawnSync(process.execPath, [script], { cwd }).status, 0);
    assert.equal(readFileSync(file, 'utf8'), content);
  } finally { rmSync(cwd, { recursive: true }); }
});
