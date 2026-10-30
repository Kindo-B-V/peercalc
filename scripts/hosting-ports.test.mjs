import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const helper = fileURLToPath(new URL('./hosting-ports.sh', import.meta.url));
const run = (command, args = [], env = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', 'source "$1"; shift; ' + command, 'port-test', helper, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const engineStub = `
fake_engine() {
    if [[ \${1:-} == --host ]]; then [[ $2 == unix:///test.sock ]]; shift 2; fi
    case $1 in
        ps) printf '%s' "$DOCKER_IDS"; return "\${DOCKER_PS_STATUS:-0}" ;;
        inspect) [[ $2 == --format && $3 == '{{json .NetworkSettings.Ports}}' && $4 == -- ]]; printf '%s' "$DOCKER_INSPECT"; return "\${DOCKER_INSPECT_STATUS:-0}" ;;
        *) return 1 ;;
    esac
}`;
const collector = `ss() { printf '%s' "$SS_OUTPUT"; return "\${SS_STATUS:-0}"; }; ${engineStub}; collect_occupied_ports fake_engine --host unix:///test.sock`;
const data = {
  SS_OUTPUT: 'LISTEN 0 128 127.0.0.1:8788 0.0.0.0:*\nLISTEN 0 128 [::]:443 [::]:*\n',
  DOCKER_IDS: 'container-a\ncontainer-b',
  DOCKER_INSPECT: '{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"80"}],"53/udp":[{"HostPort":"53"}]}\n{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8789"},{"HostIp":"::1","HostPort":"8789"}],"9000/tcp":null}',
};

test('collects and deduplicates real TCP listeners and Docker-published ports without userland listeners', () => {
  const result = run(collector, [], data);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), ['80', '443', '8788', '8789']);
});

test('empty listeners and no running containers are valid, not collection errors', () => {
  const result = run(collector, [], { SS_OUTPUT: '', DOCKER_IDS: '', DOCKER_INSPECT: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('port collection fails closed on command failures, malformed ports or incomplete inspect results', () => {
  for (const broken of [
    { SS_STATUS: '1' }, { DOCKER_PS_STATUS: '1' }, { DOCKER_INSPECT_STATUS: '1' },
    { SS_OUTPUT: 'invalid' }, { SS_OUTPUT: 'LISTEN 0 128 [::]:oops [::]:*' },
    { DOCKER_INSPECT: '{}' }, { DOCKER_INSPECT: 'not JSON' },
    { DOCKER_INSPECT: '{"80/tcp":[{"HostPort":"0"}]}\nnull' },
    { DOCKER_INSPECT: '{"80/tcp":[{"HostPort":"65536"}]}\nnull' },
  ]) {
    const result = run(collector, [], { ...data, ...broken });
    assert.notEqual(result.status, 0, JSON.stringify(broken));
    assert.equal(result.stdout, '');
  }
});

test('scans sequentially with validated bounds and reports exhaustion', () => {
  assert.equal(run('select_free_port "$1"', ['8788\n8789\n8791']).stdout.trim(), '8790');
  assert.equal(run('select_free_port "$1" "$2"', ['', '65535']).stdout.trim(), '65535');
  assert.notEqual(run('select_free_port "$1" "$2"', ['65535', '65535']).status, 0);
  for (const start of ['0', '80', '65536', '-1', '8788;id', '08788', '']) {
    if (start === '') continue;
    assert.notEqual(run('select_free_port "" "$1"', [start]).status, 0);
  }
  assert.notEqual(run('select_free_port "$1"', ['80\nnot-a-port']).status, 0);
});

const configure = (root, occupied = '', edge = 'false', gateway = '') => run('configure_deployment "$1" "$2" "$3" "$4"; printf "%s:%s" "$PEERCALC_DEPLOYMENT_MODE" "$PEERCALC_HTTP_PORT"', [root, occupied, edge, gateway]);
const temporary = () => mkdtempSync(join(tmpdir(), 'peercalc-ports-'));

test('chooses standalone or scans a proxy port while preserving secrets and private state permissions', () => {
  for (const [occupied, expected] of [['', 'standalone:0'], ['80\n8788\n8789', 'proxy:8790'], ['443', 'proxy:8788']]) {
    const root = temporary();
    try {
      writeFileSync(join(root, '.env.hosting'), 'unchanged-secrets');
      const result = configure(root, occupied);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(readFileSync(join(root, '.env.hosting'), 'utf8'), 'unchanged-secrets');
      assert.equal(statSync(join(root, '.hosting')).mode & 0o777, 0o700);
      assert.equal(statSync(join(root, '.hosting/deployment.env')).mode & 0o777, 0o600);
      assert.equal(configure(root, occupied).stdout, expected);
    } finally { rmSync(root, { recursive: true }); }
  }
});

test('preserves a proxy target when free or owned, but scans and warns when another service takes it', () => {
  const root = temporary();
  try {
    assert.equal(configure(root, '80\n8788').stdout, 'proxy:8789');
    const original = readFileSync(join(root, '.hosting/deployment.env'), 'utf8');
    assert.equal(configure(root).stdout, 'proxy:8789');
    assert.equal(readFileSync(join(root, '.hosting/deployment.env'), 'utf8'), original);
    assert.equal(configure(root, '80\n8788\n8789', 'false', '8789').stdout, 'proxy:8789');
    const moved = configure(root, '80\n8788\n8789');
    assert.equal(moved.stdout, 'proxy:8790');
    assert.match(moved.stderr, /8789.*8790.*proxyroute/);
  } finally { rmSync(root, { recursive: true }); }
});

test('reuses our standalone edge, or switches to proxy if a different service owns public ports', () => {
  const root = temporary();
  try {
    assert.equal(configure(root, '80\n443', 'true').stdout, 'standalone:0');
    assert.equal(configure(root, '80\n443', 'true').stdout, 'standalone:0');
    const moved = configure(root, '80\n443');
    assert.equal(moved.stdout, 'proxy:8788');
    assert.match(moved.stderr, /standalone:0.*proxy:8788/);
  } finally { rmSync(root, { recursive: true }); }
});

test('rejects malformed, duplicate, missing, executable, nonregular or symlinked persisted state without replacing it', () => {
  const root = temporary();
  try {
    mkdirSync(join(root, '.hosting'));
    const path = join(root, '.hosting/deployment.env');
    for (const state of [
      'PEERCALC_DEPLOYMENT_MODE=proxy\n',
      'PEERCALC_DEPLOYMENT_MODE=proxy\nPEERCALC_HTTP_PORT=80\n',
      'PEERCALC_DEPLOYMENT_MODE=standalone\nPEERCALC_HTTP_PORT=8788\n',
      'PEERCALC_DEPLOYMENT_MODE=proxy\nPEERCALC_HTTP_PORT=\nPEERCALC_HTTP_PORT=8792\n',
      'PEERCALC_DEPLOYMENT_MODE=proxy\nPEERCALC_DEPLOYMENT_MODE=proxy\nPEERCALC_HTTP_PORT=8788\n',
      'PEERCALC_DEPLOYMENT_MODE=proxy\nPEERCALC_HTTP_PORT=$(touch marker)\n',
      'PEERCALC_DEPLOYMENT_MODE=proxy\nPEERCALC_HTTP_PORT=8788\nUNKNOWN=x\n',
    ]) {
      writeFileSync(path, state);
      assert.notEqual(configure(root).status, 0);
      assert.equal(readFileSync(path, 'utf8'), state);
    }
    rmSync(path);
    const target = join(root, 'target');
    writeFileSync(target, 'do-not-modify');
    symlinkSync(target, path);
    assert.notEqual(configure(root).status, 0);
    assert.equal(readFileSync(target, 'utf8'), 'do-not-modify');
    rmSync(path);
    mkdirSync(path);
    assert.notEqual(configure(root).status, 0);
  } finally { rmSync(root, { recursive: true }); }
});

test('configuration globals are not exported even if inherited values were exported', () => {
  const root = temporary();
  try {
    const result = run('export PEERCALC_DEPLOYMENT_MODE=proxy PEERCALC_HTTP_PORT=9000; configure_deployment "$1" "" false ""; [[ $(declare -p PEERCALC_DEPLOYMENT_MODE) != "declare -x "* && $(declare -p PEERCALC_HTTP_PORT) != "declare -x "* ]]', [root]);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(root, { recursive: true }); }
});

test('a real occupied TCP port is skipped', async t => {
  if (spawnSync('ss', ['-H', '-ltn']).status !== 0) { t.skip('ss unavailable'); return; }
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const port = server.address().port;
    const result = run('fake_engine() { [[ $1 == ps ]]; }; occupied=$(collect_occupied_ports fake_engine); select_free_port "$occupied" "$1"', [String(port)]);
    assert.equal(result.status, 0, result.stderr);
    assert(Number(result.stdout.trim()) > port);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
