// Builds vendor/protected/{owner,signout}.mjs (the protected packet client bundled for the
// browser) and records their provenance. The bundle is committed; `--check` rebuilds it in
// memory and fails if the committed bytes or provenance differ, so a stale bundle cannot ship.
//
//   node scripts/prepare-protected-browser.mjs            # regenerate
//   node scripts/prepare-protected-browser.mjs --check    # verify only
//
// esbuild comes from PROTECTED_ESBUILD_MODULE (a path to esbuild's lib/main.js) when set,
// otherwise from the pinned devDependency. Paths in the output and in PROVENANCE.json are
// normalised to `extension/` and `packet-core/`, so the private (spikes/...) and public
// (packages/...) layouts produce identical bytes and provenance.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const check = process.argv.includes('--check');
const esbuild = process.env.PROTECTED_ESBUILD_MODULE
  ? await import(pathToFileURL(path.resolve(process.env.PROTECTED_ESBUILD_MODULE)))
  : await import('esbuild');
const { build } = esbuild;
const esbuildVersion = esbuild.version ?? esbuild.default?.version;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = file => access(path.join(root, file)).then(() => true, () => false);
const extensionDir = await exists('packages/browser-extension') ? 'packages/browser-extension' : 'packages/browser-extension';
const packetDir = await exists('packages/protected-packet-core') ? 'packages/protected-packet-core' : 'packages/protected-packet-core';
const vendorDir = `${extensionDir}/vendor/protected`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const normalise = rel => rel.split(path.sep).join('/')
  .replace(/^(?:spikes|packages)\/browser-extension\//, 'extension/')
  .replace(/^(?:spikes|packages)\/protected-packet-core\//, 'packet-core/');
const normaliseComments = text => text
  .replace(/^\/\/ (?:spikes|packages)\/browser-extension\//gm, '// extension/')
  .replace(/^\/\/ (?:spikes|packages)\/protected-packet-core\//gm, '// packet-core/');

const inventory = new Map(), outputs = [], files = new Map();
for (const [entry, name] of [['browser-entry', 'owner'], ['browser-signout', 'signout']]) {
  const result = await build({ absWorkingDir: root, entryPoints: [`./${packetDir}/client/${entry}.mjs`], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'chrome133', metafile: true, legalComments: 'eof', define: { 'process.versions.node': 'undefined' },
    plugins: [{ name: 'review-overlay', setup(b) {
      b.onResolve({ filter: /build-info\.mjs$/ }, () => ({ path: '../../src/build-info.mjs', external: true }));
      // Resolve relative imports inside the repository ourselves (as the reviewed bundle always
      // has); this keeps esbuild's output byte-stable rather than applying package side-effect hints.
      b.onResolve({ filter: /^\.\.?\// }, async args => {
        const target = path.resolve(args.resolveDir, args.path), rel = path.relative(root, target);
        if (!rel.startsWith('..')) { try { await readFile(target); return { path: target }; } catch {} }
      });
      b.onLoad({ filter: /\.(mjs|js)$/ }, async args => {
        const bytes = await readFile(args.path), rel = normalise(path.relative(root, args.path));
        inventory.set(rel, { path: rel, sha256: sha(bytes) });
        const contents = bytes.toString().replace("new URL('../local-hash-worker.mjs', import.meta.url)", "new URL('../../local-hash-worker.mjs', import.meta.url)");
        return { contents, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    } }] });
  const bytes = Buffer.from(normaliseComments(Buffer.from(result.outputFiles[0].contents).toString('utf8')));
  files.set(`${name}.mjs`, bytes);
  outputs.push({ path: `vendor/protected/${name}.mjs`, sha256: sha(bytes), bytes: bytes.length });
}
const licenses = [];
for (const [pkg, file] of [['jose', 'LICENSE.md'], ['libsodium-wrappers-sumo', 'LICENSE'], ['libsodium-sumo', 'LICENSE']]) {
  licenses.push(`===== ${pkg} =====\n${await readFile(path.join(root, packetDir, 'node_modules', pkg, file))}`);
}
files.set('LICENSES.txt', Buffer.from(licenses.join('\n')));
files.set('PROVENANCE.json', Buffer.from(JSON.stringify({ format: 1, privateOnly: true, fixtureTrustIncluded: false, builder: { esbuild: esbuildVersion },
  inputs: [...inventory.values()].sort((a, b) => a.path.localeCompare(b.path)), outputs }, null, 2) + '\n'));

if (check) {
  const stale = [];
  for (const [name, bytes] of files) {
    const committed = await readFile(path.join(root, vendorDir, name)).catch(() => null);
    if (!committed?.equals(bytes)) stale.push(name);
  }
  console.log(JSON.stringify({ check: stale.length ? 'stale' : 'current', esbuild: esbuildVersion, stale }));
  if (stale.length) process.exitCode = 1;
} else {
  await mkdir(path.join(root, vendorDir), { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(root, vendorDir, name), bytes);
  console.log(JSON.stringify({ outputs, inputs: inventory.size, esbuild: esbuildVersion }));
}
