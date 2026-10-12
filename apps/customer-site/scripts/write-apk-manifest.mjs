#!/usr/bin/env node
// In-app updates (owner, 2026-10-12): writes the version manifest that sits
// next to a staff APK on the landing site, e.g. apps/customer-site/files/ops.json
// served at https://blynk.lk/download/ops.json. Blynk Ops and Blynk Rider read
// it to offer an update, then download the APK and check its size and SHA-256
// against these values before Android's installer opens.
//
// Offline: reads only the APK. Release steps: docs/06-deployment/staff-app-updates.md
//
// Usage (from the repo root):
//   node apps/customer-site/scripts/write-apk-manifest.mjs --app ops \
//     --apk apps/customer-site/files/ops.apk --version-code 57 --version-name 1.2
// Options: --out <file> (default apps/customer-site/files/<app>.json),
//          --released-at <ISO time> (default now).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPS = ['ops', 'rider'];
const FILES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'files');
const MAX_VERSION_CODE = 2_100_000_000;

export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Validates the inputs, hashes the APK and writes the manifest. Returns it. */
export async function writeApkManifest({ app, apk, versionCode, versionName, out, releasedAt }) {
  if (!APPS.includes(app)) throw new Error(`--app must be one of: ${APPS.join(', ')}`);
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code < 1 || code > MAX_VERSION_CODE) {
    throw new Error('--version-code must be a whole number from 1 (the APK\'s versionCode)');
  }
  const name = String(versionName ?? '').trim();
  if (!name || name.length > 40) throw new Error('--version-name is required (e.g. 1.2), at most 40 characters');
  if (!apk || !existsSync(apk)) throw new Error(`APK not found: ${apk}`);
  const size = statSync(apk).size;
  if (size === 0) throw new Error(`APK is empty: ${apk}`);
  const head = readFileSync(apk).subarray(0, 2).toString('latin1');
  if (head !== 'PK') throw new Error(`Not an APK (zip) file: ${apk}`);
  const released = releasedAt ? new Date(releasedAt) : new Date();
  if (Number.isNaN(released.getTime())) throw new Error('--released-at must be an ISO date/time');

  const manifest = {
    app,
    version_code: code,
    version_name: name,
    sha256: await sha256File(apk),
    size,
    released_at: released.toISOString(),
  };
  const target = out ?? join(FILES_DIR, `${app}.json`);
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, path: resolve(target) };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    i++;
  }
  return {
    app: args.app,
    apk: args.apk,
    versionCode: args['version-code'],
    versionName: args['version-name'],
    out: args.out,
    releasedAt: args['released-at'],
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { manifest, path } = await writeApkManifest(parseArgs(process.argv.slice(2)));
    console.log(`Wrote ${path}`);
    console.log(JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
