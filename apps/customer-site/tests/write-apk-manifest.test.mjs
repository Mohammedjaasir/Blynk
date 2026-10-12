// In-app updates (owner, 2026-10-12): the APK version manifest writer. Offline.
// Run from the repo root:  node --test apps/customer-site/tests/write-apk-manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeApkManifest } from '../scripts/write-apk-manifest.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'write-apk-manifest.mjs');

function fakeApk(bytes = 'PK\u0003\u0004 fake apk body') {
  const dir = mkdtempSync(join(tmpdir(), 'blynk-apk-'));
  const apk = join(dir, 'ops.apk');
  writeFileSync(apk, bytes, 'latin1');
  return { dir, apk, buffer: readFileSync(apk) };
}

test('writes app, version, sha256, size and released_at', async () => {
  const { dir, apk, buffer } = fakeApk();
  const out = join(dir, 'ops.json');
  const { manifest } = await writeApkManifest({
    app: 'ops',
    apk,
    versionCode: '57',
    versionName: '1.2',
    out,
    releasedAt: '2026-10-12T06:00:00Z',
  });
  const expected = {
    app: 'ops',
    version_code: 57,
    version_name: '1.2',
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
    released_at: '2026-10-12T06:00:00.000Z',
  };
  assert.deepEqual(manifest, expected);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), expected);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
});

test('refuses bad input', async () => {
  const { dir, apk } = fakeApk();
  const out = join(dir, 'x.json');
  const base = { app: 'rider', apk, versionCode: 3, versionName: '1.2', out };
  await assert.rejects(writeApkManifest({ ...base, app: 'customer' }), /--app/);
  await assert.rejects(writeApkManifest({ ...base, versionCode: 0 }), /--version-code/);
  await assert.rejects(writeApkManifest({ ...base, versionCode: '2.5' }), /--version-code/);
  await assert.rejects(writeApkManifest({ ...base, versionName: ' ' }), /--version-name/);
  await assert.rejects(writeApkManifest({ ...base, apk: join(dir, 'missing.apk') }), /not found/);
  await assert.rejects(writeApkManifest({ ...base, releasedAt: 'soon' }), /--released-at/);
  const notZip = fakeApk('hello');
  await assert.rejects(writeApkManifest({ ...base, apk: notZip.apk }), /Not an APK/);
});

test('command line: writes the file and exits 0; a mistake exits 1', () => {
  const { dir, apk } = fakeApk();
  const out = join(dir, 'rider.json');
  const ok = spawnSync(
    process.execPath,
    [script, '--app', 'rider', '--apk', apk, '--version-code', '4', '--version-name', '1.3', '--out', out],
    { encoding: 'utf8' }
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).version_code, 4);
  const bad = spawnSync(process.execPath, [script, '--app', 'rider', '--apk', apk], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--version-code/);
});
