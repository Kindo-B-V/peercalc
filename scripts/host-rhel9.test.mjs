import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./host-rhel9.sh', import.meta.url));
const realm = fileURLToPath(new URL('../infra/peercalc-realm.json', import.meta.url));
const run = (command, ...args) => spawnSync('bash', ['-c', 'source "$1"; shift; ' + command, 'hosting-test', script, ...args], { encoding: 'utf8' });

test('installer parses and help does not run privileged commands', () => {
  assert.equal(spawnSync('bash', ['-n', script]).status, 0);
  const help = spawnSync('bash', [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /domeinnaam/);
});

test('domain validation blocks URL, shell/config injection, IPs, reserved names and invalid labels', () => {
  for (const domain of ['calc.kindo.nl', 'a.bouw-bedrijf.nl', 'xn--bouw-9za.nl']) {
    assert.equal(run('validate_domain "$1"', domain).status, 0, domain);
  }
  for (const domain of ['', 'localhost', 'https://calc.kindo.nl', 'calc.kindo.nl:443', 'a.nl/path', 'a.nl;id', 'a.nl\nb.nl', '*.kindo.nl', '.kindo.nl', 'kindo.nl.', 'a..nl', '-a.nl', 'a-.nl', '127.0.0.1', 'a.test', 'a.internal', `${'a'.repeat(64)}.nl`]) {
    assert.notEqual(run('validate_domain "$1"', domain).status, 0, JSON.stringify(domain));
  }
});

test('platform guard accepts RHEL 9 and Rocky 9, not other distributions or major versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'peercalc-os-'));
  try {
    const os = join(root, 'os-release');
    for (const [content, valid] of [
      ['ID="rhel"\nVERSION_ID="9.7"\n', true],
      ['NAME="Rocky Linux"\nVERSION="9.5 (Blue Onyx)"\nID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.5"\nPLATFORM_ID="platform:el9"\n', true],
      ['ID=rocky\nVERSION_ID=9\n', true],
      ['ID=rhel\nVERSION_ID=8.10\n', false],
      ['ID=rocky\nVERSION_ID=8.10\n', false],
      ['ID=rocky\nVERSION_ID=10.0\n', false],
      ['ID=unknown\nID_LIKE="rhel centos fedora"\nVERSION_ID=9.5\n', false],
      ['ID=ubuntu\nVERSION_ID=24.04\n', false],
    ]) {
      writeFileSync(os, content);
      assert.equal(run('check_rhel "$1"', os).status === 0, valid);
    }
  } finally { rmSync(root, { recursive: true }); }
});

test('Compose must use saved hosting values instead of exported shell overrides', () => {
  const result = run('export PEERCALC_DOMAIN=wrong.nl PEERCALC_DB_PASSWORD=wrong CALC_CONVERTER_TOKEN=wrong ACME_EMAIL=wrong; clear_hosting_overrides; [[ ! -v PEERCALC_DOMAIN && ! -v PEERCALC_DB_PASSWORD && ! -v CALC_CONVERTER_TOKEN && ! -v ACME_EMAIL ]]');
  assert.equal(result.status, 0, result.stderr);
});

test('host package setup reuses installed curl-minimal and installs curl only when absent', () => {
  const installed = run('curl() { :; }; dnf() { printf "%s\\n" "$@"; }; install_host_packages');
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.stdout.trim().split('\n').includes('curl'), false);
  const missing = run('PATH=/nonexistent; dnf() { printf "%s\\n" "$@"; }; install_host_packages');
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.stdout.trim().split('\n').includes('curl'), true);
  assert(installed.stdout.includes('dnf-plugins-core'));
  assert(missing.stdout.includes('dnf-plugins-core'));
});

function temporaryRepo() {
  const root = mkdtempSync(join(tmpdir(), 'peercalc-hosting-'));
  mkdirSync(join(root, 'infra'));
  copyFileSync(realm, join(root, 'infra/peercalc-realm.json'));
  return root;
}
const configure = root => run('configure_hosting "$1" calc.kindo.nl owner@calc.kindo.nl', root);

test('hosting config generates private unique secrets and closed registration without embedding secrets in realm', () => {
  const root = temporaryRepo();
  try {
    const result = configure(root);
    assert.equal(result.status, 0, result.stderr);
    const content = readFileSync(join(root, '.env.hosting'), 'utf8');
    const env = Object.fromEntries(content.trim().split('\n').map(line => line.split('=')));
    assert.equal(env.PEERCALC_DOMAIN, 'calc.kindo.nl');
    assert.equal(Buffer.from(env.PEERCALC_COOKIE_SECRET, 'base64url').length, 32);
    const secrets = Object.entries(env).filter(([key]) => key.endsWith('_SECRET') || key.endsWith('_PASSWORD') || key.endsWith('_TOKEN')).map(([, value]) => value);
    assert.equal(new Set(secrets).size, 6);
    assert.equal(statSync(join(root, '.env.hosting')).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, '.hosting')).mode & 0o777, 0o700);
    assert.equal(statSync(join(root, '.hosting/peercalc-realm.json')).mode & 0o777, 0o644);
    const imported = JSON.parse(readFileSync(join(root, '.hosting/peercalc-realm.json'), 'utf8'));
    assert.equal(imported.registrationAllowed, false);
    assert.equal(imported.sslRequired, 'external');
    assert.equal(imported.users[0].username, 'owner@calc.kindo.nl');
    assert.equal(imported.clients[0].secret, '${PEERCALC_CLIENT_SECRET}');
    assert.equal(imported.users[0].credentials[0].value, '${PEERCALC_OWNER_PASSWORD}');
    assert.equal(readFileSync(join(root, 'infra/peercalc-realm.json'), 'utf8'), readFileSync(realm, 'utf8'));
    assert.equal(secrets.some(secret => result.stdout.includes(secret) || result.stderr.includes(secret)), false);
    assert.equal(configure(root).status, 0);
    assert.equal(readFileSync(join(root, '.env.hosting'), 'utf8'), content);
    const changed = run('configure_hosting "$1" other.kindo.nl owner@other.kindo.nl', root);
    assert.notEqual(changed.status, 0);
    assert.equal(readFileSync(join(root, '.env.hosting'), 'utf8'), content);
  } finally { rmSync(root, { recursive: true }); }
});

test('partial, executable or duplicate dotenv entries are rejected without execution or secret rotation', () => {
  const root = temporaryRepo();
  try {
    assert.equal(configure(root).status, 0);
    const file = join(root, '.env.hosting');
    const initial = readFileSync(file, 'utf8');
    for (const broken of [initial.replace(/^PEERCALC_DB_PASSWORD=.*\n/m, ''), initial + 'PEERCALC_DOMAIN=other.kindo.nl\n', initial + 'ATTACK=$(touch marker)\n']) {
      writeFileSync(file, broken);
      assert.notEqual(configure(root).status, 0);
      assert.equal(readFileSync(file, 'utf8'), broken);
    }
  } finally { rmSync(root, { recursive: true }); }
});

test('rendered hosting stack uses preserved secrets, fixed project and private internal ports', t => {
  if (spawnSync('docker', ['compose', 'version']).status !== 0) {
    t.skip('Docker Compose is required for configuration rendering.');
    return;
  }
  const root = temporaryRepo();
  try {
    assert.equal(configure(root).status, 0);
    const file = fileURLToPath(new URL('../compose.hosting.yaml', import.meta.url));
    const result = run('export PEERCALC_DOMAIN=wrong.nl PEERCALC_DB_PASSWORD=wrong CALC_CONVERTER_TOKEN=wrong COMPOSE_PROJECT_NAME=wrong; clear_hosting_overrides; docker compose --project-name peercalc-hosting --env-file "$1/.env.hosting" -f "$2" config --format json', root, file);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    const env = Object.fromEntries(readFileSync(join(root, '.env.hosting'), 'utf8').trim().split('\n').map(line => line.split('=')));
    assert.equal(config.name, 'peercalc-hosting');
    assert.equal(config.services.identity.environment.KC_DB_PASSWORD === env.PEERCALC_DB_PASSWORD, true);
    assert.equal(config.services.web.environment.CALC_CONVERTER_TOKEN === env.CALC_CONVERTER_TOKEN, true);
    assert.equal(config.services.identity.environment.KC_HOSTNAME, 'https://calc.kindo.nl/auth');
    assert.equal(config.services.identity.command[0], 'start');
    assert.equal(config.services.identity.environment.KC_DB, 'postgres');
    assert(config.services.login.command.includes('--cookie-secure=true'));
    assert(config.services.login.command.includes('--insecure-oidc-skip-nonce=false'));
    assert(config.services.login.command.includes('--insecure-oidc-allow-unverified-email=false'));
    assert.deepEqual(Object.entries(config.services).flatMap(([name, service]) => (service.ports ?? []).map(port => [name, Number(port.published)])), [['edge', 80], ['edge', 443]]);
  } finally { rmSync(root, { recursive: true }); }
});

test('proxy override excludes the edge and publishes only the selected loopback gateway', t => {
  if (spawnSync('docker', ['compose', 'version']).status !== 0) {
    t.skip('Docker Compose is required for configuration rendering.');
    return;
  }
  const root = temporaryRepo();
  try {
    assert.equal(configure(root).status, 0);
    const selected = run('configure_deployment "$1" $\'80\\n8788\' false ""', root);
    assert.equal(selected.status, 0, selected.stderr);
    const base = fileURLToPath(new URL('../compose.hosting.yaml', import.meta.url));
    const proxy = fileURLToPath(new URL('../compose.proxy.yaml', import.meta.url));
    const result = run('clear_hosting_overrides; unset COMPOSE_PROFILES; docker compose --project-name peercalc-hosting --env-file "$1/.env.hosting" --env-file "$1/.hosting/deployment.env" -f "$2" -f "$3" config --format json', root, base, proxy);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(Object.hasOwn(config.services, 'edge'), false);
    assert.deepEqual(Object.entries(config.services).flatMap(([name, service]) => (service.ports ?? []).map(port => [name, port.host_ip, Number(port.published), port.target])), [['gateway', '127.0.0.1', 8789, 8080]]);
    assert.equal(config.services.identity.environment.KC_HOSTNAME, 'https://calc.kindo.nl/auth');
    assert(config.services.login.command.includes('--redirect-url=https://calc.kindo.nl/oauth2/callback'));
    assert(config.services.login.command.includes('--cookie-secure=true'));
  } finally { rmSync(root, { recursive: true }); }
});

test('generated proxy examples use the chosen gateway and do not change base configuration', () => {
  const root = temporaryRepo();
  try {
    assert.equal(configure(root).status, 0);
    const result = run('write_proxy_examples "$1" calc.kindo.nl 8793', root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(root, '.hosting/nginx-location.conf'), 'utf8'), /proxy_pass http:\/\/127\.0\.0\.1:8793;/);
    assert.match(readFileSync(join(root, '.hosting/Caddyfile.proxy'), 'utf8'), /calc\.kindo\.nl \{\n    reverse_proxy 127\.0\.0\.1:8793/);
    assert.equal(statSync(join(root, '.hosting/Caddyfile.proxy')).mode & 0o777, 0o600);
    assert.notEqual(run('write_proxy_examples "$1" calc.kindo.nl "8793;id"', root).status, 0);
    assert.equal(readFileSync(join(root, 'infra/peercalc-realm.json'), 'utf8'), readFileSync(realm, 'utf8'));
  } finally { rmSync(root, { recursive: true }); }
});
