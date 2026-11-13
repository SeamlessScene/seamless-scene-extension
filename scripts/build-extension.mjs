import { existsSync } from 'node:fs';
import { readFile, lstat, realpath, mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The public repository keeps the extension in packages/, the private one in spikes/. This file
// is part of the build identity, so the same bytes must build from either layout.
const defaultSource = path.join(repository, existsSync(path.join(repository, 'packages/browser-extension')) ? 'packages' : 'spikes', 'browser-extension');
const { catalogControlOrigin } = await import(pathToFileURL(path.join(defaultSource, 'src/catalog-control-updates.mjs')).href);
const entries = ['viewer.mjs', 'edits-page.mjs', 'welcome.mjs', 'catalog-account.mjs', 'background.mjs', 'authoring-sidepanel.mjs', 'authoring-image-worker.mjs', 'local-hash-worker.mjs', 'native-review.mjs', 'local-playback-frame.mjs', 'src/main.mjs', 'src/prime-identity-endpoint.mjs'];
const staticFiles = [...['active','armed','inactive','neutral'].flatMap(t=>[16,32,48,128].map(n=>`icons/ss-${t}-${n}.png`)),'viewer-popup.html', 'viewer-settings.html', 'welcome.html', 'viewer.css', 'catalog-account.html', 'catalog-account.css', 'manifest.json', 'bootstrap.js', 'authoring-page-bridge.js', 'authoring-sidepanel.html', 'authoring-sidepanel.css', 'native-review.html', 'native-review.css', 'local-playback-frame.html', 'local-playback-frame.css', 'media/replacement.mp4'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const protectedModules = new Set(['vendor/protected/owner.mjs', 'vendor/protected/signout.mjs']);
export const protectedStaticFiles = ['vendor/protected/PROVENANCE.json', 'vendor/protected/LICENSES.txt'];
const vendorModules = new Set(['vendor/hash-wasm/sha256.js', ...protectedModules]);
staticFiles.push(...protectedStaticFiles);
export function verifyProtectedInputs(inputs) {
  const receipt = JSON.parse(inputs.get('vendor/protected/PROVENANCE.json'));
  if (receipt.format !== 1 || receipt.privateOnly !== true || receipt.fixtureTrustIncluded !== false || receipt.outputs.length !== 2 || !receipt.inputs.length) throw Error('Protected provenance required');
  for (const name of protectedModules) {
    const output = receipt.outputs.find(o => o.path === name), bytes = inputs.get(name);
    if (!output || !bytes || output.bytes !== bytes.length || output.sha256 !== sha256(bytes)) throw Error('Protected bundle provenance mismatch');
  }
}

// The bundle's recorded inputs must still match the sources it was built from; otherwise an
// edited protected-client or extension module would ship inside a stale bundle. Paths are
// normalised (extension/..., packet-core/...) so the check works in either repository layout.
export async function verifyProtectedSources(extensionRoot, inputs) {
  const receipt = JSON.parse(inputs.get('vendor/protected/PROVENANCE.json'));
  const packetRoots = ['../protected-packet-core', '../packet-core'].map(dir => path.resolve(extensionRoot, dir));
  for (const input of receipt.inputs) {
    const [scope, ...rest] = input.path.split('/'), relative = rest.join('/');
    const candidates = scope === 'extension' ? [path.join(extensionRoot, relative)]
      : scope === 'packet-core' ? packetRoots.map(dir => path.join(dir, relative)) : [];
    let bytes = null;
    for (const file of candidates) { try { bytes = await readFile(file); break; } catch {} }
    if (!bytes) throw Error(`Protected bundle input missing: ${input.path} (install the packet-core dependencies)`);
    if (sha256(bytes) !== input.sha256) throw Error(`Protected bundle is stale: ${input.path} changed; run scripts/prepare-protected-browser.mjs`);
  }
}

staticFiles.push('vendor/hash-wasm/LICENSE', 'vendor/hash-wasm/LICENSE-SHA256', 'vendor/hash-wasm/PROVENANCE.json');
const sorted = entries => [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const inventory = files => sorted(files).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) }));
const inventoryDigest = files => sha256(JSON.stringify(inventory(files)));

// Deliberately constrained to the project's local static ESM syntax. New remote,
// computed or queried dependencies require explicit build review, not silent copying.
export function moduleDependencies(source, name) {
  // Generated closure is independently hash-checked against its packaged
  // provenance before admission. Its sole external dependency is build identity.
  if (protectedModules.has(name)) return ['src/build-info.mjs'];
  const dependencies = [...source.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"]([^'"\r\n]+)['"]/gm)].map(match => match[1]);
  // The only reviewed dynamic import: the identity-bridge injection in the service worker's composition.
  if (/\bimport\s*\(/.test(source) && !(name === 'background-services.mjs' && source.match(/\bimport\s*\(/g).length === 1 && source.includes('await import(url)'))) {
    throw Error(`Unreviewed dynamic import: ${name}`);
  }
  return dependencies.map(dependency => {
    if (!/^\.\.?\/[a-z0-9_./-]+\.(?:mjs|js)$/.test(dependency)) throw Error(`Unsupported module dependency: ${name}`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency));
    if (!/^(?:src\/)?[a-z0-9-]+\.mjs$/.test(target) && !vendorModules.has(target)) throw Error(`Module escapes build scope: ${name}`);
    return target;
  });
}

// protectedSources: verify the protected bundle's inputs against their sources (off only for
// tests that build from a partial copy holding just the extension's own inputs).
// Profiles: 'release' (the default, and what testers install) serves only the
// streaming sites and exposes to pages exactly the modules the page-side entries
// load; 'dev' keeps the localhost fixture page, its content scripts and media.
export const BUILD_PROFILES = Object.freeze(['release', 'dev']);
const LOCAL_ORIGINS = new Set(['http://127.0.0.1/*', 'http://localhost/*']);
// Page-loaded entries: the content-script controller (bootstrap.js) and the
// identity reader injected into the player page (background-services.mjs).
const PAGE_ENTRIES = ['src/main.mjs', 'src/prime-identity-endpoint.mjs'];
const PAGE_FORBIDDEN = /\/(?:device-link-|device-credentials|viewer-store|viewer-service|catalog-discovery|update-notice)/;

// Editions: 'full' (the default) carries Creator tools; 'viewer' is the store edition. It leaves out
// the Creator entries and pages, reads each edition module from its viewer counterpart (same exports,
// so static imports never reach Creator or fixture code), and drops HTML marked <!-- @creator -->.
// A checkout holding only the viewer edition (the public repository) keeps those modules under
// their own names, so with no counterpart present the module itself is read.
export const BUILD_EDITIONS = Object.freeze(['full', 'viewer']);
const CREATOR_ENTRIES = new Set(['authoring-sidepanel.mjs', 'authoring-image-worker.mjs', 'native-review.mjs']);
const CREATOR_STATIC = new Set(['authoring-page-bridge.js', 'authoring-sidepanel.html', 'authoring-sidepanel.css', 'native-review.html', 'native-review.css']);
const VIEWER_MODULES = new Map([['src/edition-background.mjs', 'src/edition-background-viewer.mjs'], ['src/edition-page.mjs', 'src/edition-page-viewer.mjs']]);
const CREATOR_MARKUP = /<!-- @creator -->[\s\S]*?<!-- \/@creator -->/g;

function applyEdition(manifest, edition) {
  if (edition === 'full') return;
  delete manifest.side_panel;
  // The store assigns the extension's key and ID.
  delete manifest.key;
  manifest.permissions = manifest.permissions.filter(permission => permission !== 'sidePanel');
  if (manifest.content_scripts) manifest.content_scripts = manifest.content_scripts.map(group => ({ ...group, js: group.js.filter(script => !CREATOR_STATIC.has(script)) }));
}

function applyProfile(manifest, profile) {
  if (profile === 'dev') return;
  manifest.host_permissions = (manifest.host_permissions ?? []).filter(origin => !LOCAL_ORIGINS.has(origin));
  manifest.content_scripts = (manifest.content_scripts ?? []).map(group => ({ ...group, matches: group.matches.filter(origin => !LOCAL_ORIGINS.has(origin)) }))
    .filter(group => group.matches.length);
  if (!manifest.content_scripts.length) delete manifest.content_scripts;
  for (const group of manifest.web_accessible_resources) {
    group.matches = group.matches.filter(origin => !LOCAL_ORIGINS.has(origin));
    group.resources = group.resources.filter(resource => resource !== 'media/*.mp4');
  }
}

// siteOrigin: build for another website origin (the day-0 move from preview.seamlessscene.com to the
// root domain). The release-managed catalog and protected configs are rewritten to it before the
// manifest is derived, so host permissions, externally_connectable and the protected issuer follow;
// the build then refuses to finish if the old host is named anywhere in the output.
export function normalizeSiteOrigin(value) {
  let url; try { url = new URL(value); } catch { throw Error(`Site origin is not a URL: ${value}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw Error(`Site origin must be a bare https origin: ${value}`);
  return url.origin;
}
function rewriteSiteOrigin(inputs, siteOrigin, keepIssuer) {
  const catalog = inputs.get('catalog-trust-config.mjs').toString('utf8'), protectedConfig = inputs.get('protected-trust-config.mjs').toString('utf8');
  const current = catalog.match(/pairingOrigin:\s*'([^'\r\n]+)'/)?.[1];
  if (!current || normalizeSiteOrigin(current) !== current) throw Error('Catalog pairing origin must be an explicit release origin');
  for (const setting of ['controlOrigin', 'pairingOrigin']) if (!catalog.includes(`${setting}: '${current}'`)) throw Error(`Catalog ${setting} differs from the pairing origin`);
  // Moving the issuer too needs it to match the pairing origin; --keep-issuer leaves it as it is.
  if (!keepIssuer && !protectedConfig.includes(`"issuer":"${current}"`)) throw Error('Protected issuer differs from the pairing origin');
  inputs.set('catalog-trust-config.mjs', Buffer.from(catalog.split(`'${current}'`).join(`'${siteOrigin}'`)));
  // The issuer is an identifier inside signed licences, not a host the extension contacts. Keeping it
  // lets old and new builds open the same licences while both are installed.
  if (!keepIssuer) inputs.set('protected-trust-config.mjs', Buffer.from(protectedConfig.split(`"issuer":"${current}"`).join(`"issuer":"${siteOrigin}"`)));
  return new URL(current).hostname;
}

export async function prepareExtensionBuild({ sourceRoot = defaultSource, protectedSources = true, profile = 'release', edition = 'full', siteOrigin = null, keepIssuer = false } = {}) {
  if (!BUILD_PROFILES.includes(profile)) throw Error(`Unknown build profile: ${profile}`);
  if (!BUILD_EDITIONS.includes(edition)) throw Error(`Unknown build edition: ${edition}`);
  if (siteOrigin !== null) siteOrigin = normalizeSiteOrigin(siteOrigin);
  const viewer = edition === 'viewer', root = await realpath(sourceRoot), inputs = new Map(), modules = new Set(), substitutes = new Map();
  if (viewer) for (const [name, counterpart] of VIEWER_MODULES) if (await lstat(path.join(root, counterpart)).catch(() => null)) substitutes.set(name, counterpart);
  const sourceName = name => substitutes.get(name) ?? name;
  async function read(name) {
    if (inputs.has(name)) return inputs.get(name);
    if (inputs.size >= 256) throw Error('Extension input budget exceeded');
    const file = path.join(root, sourceName(name)), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file) throw Error(`Non-regular build input: ${name}`);
    if (stat.size > (name.endsWith('.mp4') ? 16 : 2) * 1024 * 1024) throw Error(`Build input too large: ${name}`);
    const bytes = await readFile(file); inputs.set(name, bytes); return bytes;
  }
  async function visit(name) {
    if (modules.has(name)) return;
    modules.add(name);
    for (const dependency of moduleDependencies((await read(name)).toString('utf8'), name)) await visit(dependency);
  }
  for (const name of staticFiles) if (!viewer || !CREATOR_STATIC.has(name)) await read(name);
  for (const name of entries) if (!viewer || !CREATOR_ENTRIES.has(name)) await visit(name);
  verifyProtectedInputs(inputs);
  if (protectedSources) await verifyProtectedSources(root, inputs);
  // The concurrent-edit check below compares the checkout, so keep the original bytes of rewritten configs.
  const originals = new Map(['catalog-trust-config.mjs', 'protected-trust-config.mjs'].map(name => [name, inputs.get(name)]));
  if (keepIssuer && !siteOrigin) throw Error('--keep-issuer only applies with --site-origin');
  const previousHost = siteOrigin ? rewriteSiteOrigin(inputs, siteOrigin, keepIssuer) : null;
  const protectedConfig = inputs.get('protected-trust-config.mjs').toString();
  // Released builds carry public verification keys only; never private key material or fixture trust.
  if (/"d"\s*:/.test(protectedConfig) || !/"fixtureOnly"\s*:\s*false/.test(protectedConfig)) throw Error('Protected trust must be public keys with fixtureOnly false');
  const manifest = JSON.parse(inputs.get('manifest.json'));
  const declared = inputs.get('src/build-info.mjs')?.toString('utf8').match(/export const EXTENSION_VERSION = "([\d.]+)";/)?.[1];
  if (!declared || manifest.version !== declared) throw Error('Manifest/module version mismatch');
  if (manifest.background.service_worker !== 'background.mjs') throw Error('Unreviewed background entry');
  for (const setting of ['controlOrigin','pairingOrigin']) {
    const configured = inputs.get('catalog-trust-config.mjs')?.toString('utf8').match(new RegExp(setting+":\\s*(null|'[^'\\r\\n]*'|\"[^\"\\r\\n]*\")"));
    if (!configured) throw Error('Catalog origin must be an explicit release literal');
    const origin = catalogControlOrigin(configured[1] === 'null' ? null : configured[1].slice(1,-1));
    if (origin) { const url = new URL(origin); manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), `${url.protocol}//${url.hostname}/*`])]; }
    // Only the website's creator builder may ask this extension for the creator's
    // locally marked scenes (the full edition's builder bridge).
    if (origin && setting === 'pairingOrigin') manifest.externally_connectable = { matches: [`${new URL(origin).origin}/*`] };
  }
  // Extra website origins (see catalog-trust-config.mjs) may message the extension; they get no host access.
  const extraOrigins = inputs.get('catalog-trust-config.mjs').toString('utf8').match(/websiteOrigins:\s*Object\.freeze\(\[([^\]]*)\]\)/)?.[1];
  for (const literal of extraOrigins?.split(',').map(value => value.trim()).filter(Boolean) ?? []) {
    const origin = /^'[^'\r\n]+'$/.test(literal) ? literal.slice(1, -1) : null;
    if (!origin || normalizeSiteOrigin(origin) !== origin) throw Error('Website origins must be explicit release origins');
    if (!manifest.externally_connectable) throw Error('Website origins need a pairing origin');
    manifest.externally_connectable.matches = [...new Set([...manifest.externally_connectable.matches, `${origin}/*`])];
  }

  applyProfile(manifest, profile);
  applyEdition(manifest, edition);
  const pageModules = new Set();
  const page = name => { if (pageModules.has(name)) return; pageModules.add(name); for (const dependency of moduleDependencies(inputs.get(name).toString('utf8'), name)) page(dependency); };
  for (const entry of PAGE_ENTRIES) page(entry);
  const exposed = [...pageModules].filter(name => PAGE_FORBIDDEN.test(name));
  if (exposed.length) throw Error(`Page-loaded modules must not import account or library services: ${exposed.join(', ')}`);

  const builder = await readFile(fileURLToPath(import.meta.url));
  const inputDigest = inventoryDigest(new Map([...inputs, ['@builder/build-extension.mjs', builder], [`@profile/${profile}`, Buffer.from(profile)], [`@edition/${edition}`, Buffer.from(edition)]]));
  const buildId = `sha256:${inputDigest}`, prefix = `build/${inputDigest}/`, files = new Map();
  const text = (name, value) => files.set(name, Buffer.from(value));
  // Stable extension HTML paths preserve origin/role checks. Every executable
  // module and its transitive imports live in one immutable content namespace.
  function resourceURLs(source) {
    return source.replace(/(["'])([a-z0-9/-]+\.mjs)\1/g, (match, quote, name) => modules.has(name) ? `${quote}${prefix}${name}${quote}` : match);
  }
  for (const [name, bytes] of inputs) {
    if (modules.has(name)) text(prefix + name, resourceURLs(bytes.toString('utf8')));
    else if (name === 'manifest.json') continue;
    else if (/\.(html|js)$/.test(name)) text(name, resourceURLs(viewer && name.endsWith('.html') ? bytes.toString('utf8').replace(CREATOR_MARKUP, '') : bytes.toString('utf8')));
    else files.set(name, bytes);
  }
  const identity = { version: declared, adapterVersion: declared, id: buildId, mode: 'content-addressed-artifact' };
  if (!viewer) {
    const bridge = files.get('authoring-page-bridge.js').toString('utf8');
    const marker = 'const artifactBuild = /* @extension-build */ null;';
    if (bridge.split(marker).length !== 2) throw Error('Authoring build marker missing or ambiguous');
    text('authoring-page-bridge.js', bridge.replace(marker, `const artifactBuild = Object.freeze(${JSON.stringify(identity)});`));
  }
  text(prefix + 'src/build-info.mjs', `export const EXTENSION_VERSION = ${JSON.stringify(declared)};\nexport const ADAPTER_VERSION = EXTENSION_VERSION;\nexport const BUILD_ID = ${JSON.stringify(buildId)};\nexport const EDITION = ${JSON.stringify(edition)};\nexport const EXECUTING_BUILD = Object.freeze(${JSON.stringify(identity)});\n`);
  text('background.mjs', `import './${prefix}background.mjs';\n`);
  manifest.version_name = `${declared} (${inputDigest.slice(0, 12)}${profile === 'release' ? '' : ` ${profile}`})`;
  for (const group of manifest.web_accessible_resources) {
    group.resources = group.resources.flatMap(resource => resource === 'src/*.mjs' ? [...pageModules].sort().map(name => prefix + name) : [resource]);
  }
  text('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  if (viewer) for (const [name, bytes] of files) if (name.endsWith('.html') && bytes.toString('utf8').includes('@creator')) throw Error(`Unbalanced Creator markup in ${name}`);
  // Catch additions that refer to scripts omitted from the explicit graph.
  for (const [name, bytes] of files) {
    if (!/\.(js|mjs|html)$/.test(name)) continue;
    const source = bytes.toString('utf8');
    for (const [, resource] of source.matchAll(/getURL\(["']([^"']+\.mjs)["']\)/g)) {
      if (!files.has(resource)) throw Error(`Unresolved runtime module in ${name}`);
    }
    if (name.endsWith('.html')) for (const [, script] of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
      if (!files.has(script)) throw Error(`Unresolved HTML script in ${name}`);
    }
  }
  if (previousHost && previousHost !== new URL(siteOrigin).hostname) {
    // With --keep-issuer the protected issuer field is the one allowed mention (since 0.66.0 the
    // issuer is the preview origin, which differs from the pairing origin).
    const allowed = keepIssuer ? /"issuer":"[^"]*"/g : null;
    const named = [...files].filter(([name, bytes]) => /\.(js|mjs|html|json|css)$/.test(name) && (allowed ? bytes.toString('utf8').replace(allowed, '') : bytes.toString('utf8')).includes(previousHost)).map(([name]) => name);
    if (named.length) throw Error(`The ${siteOrigin} build still names ${previousHost}: ${named.join(', ')}`);
  }
  // Refuse an observed concurrent edit rather than silently packaging a torn snapshot.
  for (const [name, bytes] of inputs) if (!(siteOrigin && originals.has(name) ? originals.get(name) : bytes).equals(await readFile(path.join(root, sourceName(name))))) throw Error(`Build source changed: ${name}`);
  const report = { schemaVersion: 1, identity, profile, edition, namespace: prefix, builderBytes: builder.length, builderSha256: sha256(builder), inputs: inventory(inputs), artifactSha256: inventoryDigest(files), files: inventory(files) };
  text('build-report.json', JSON.stringify(report, null, 2) + '\n');
  return { files, report };
}

export async function buildExtension({ outputParent = path.join(repository, 'build/extension'), ...options } = {}) {
  const prepared = await prepareExtensionBuild(options);
  await mkdir(outputParent, { recursive: true });
  // Always a new directory: never replace a loaded build or delete unrelated data.
  const output = await mkdtemp(path.join(outputParent, 'candidate-'));
  for (const [name, bytes] of prepared.files) {
    const target = path.join(output, name); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return { output, ...prepared.report };
}

export async function verifyExtensionBuild(directory) {
  const root = await realpath(directory), files = new Map();
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name), target = path.join(root, name);
      if (entry.isSymbolicLink()) throw Error('Build artifact contains a symbolic link');
      if (entry.isDirectory()) {
        if (name.split('/').length > 4) throw Error('Unexpected artifact directory depth');
        await visit(name);
      } else {
        const stat = await lstat(target);
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || files.size >= 256) throw Error('Artifact file budget exceeded');
        files.set(name, await readFile(target));
      }
    }
  }
  await visit();
  const report = JSON.parse(files.get('build-report.json')); files.delete('build-report.json');
  if (report.schemaVersion !== 1 || JSON.stringify(inventory(files)) !== JSON.stringify(report.files) || inventoryDigest(files) !== report.artifactSha256) throw Error('Artifact inventory/digest mismatch');
  const version = JSON.parse(files.get('manifest.json')).version;
  if (!/^sha256:[a-f0-9]{64}$/.test(report.identity?.id) || report.namespace !== `build/${report.identity.id.slice(7)}/` || report.identity.version !== version || report.identity.adapterVersion !== version) throw Error('Artifact build identity mismatch');
  if (!BUILD_PROFILES.includes(report.profile)) throw Error('Artifact build profile missing');
  if (!BUILD_EDITIONS.includes(report.edition)) throw Error('Artifact build edition missing');
  const marker = (kind, value) => { const bytes = Buffer.from(value); return { path: `@${kind}/${value}`, bytes: bytes.length, sha256: sha256(bytes) }; };
  const inputs = [...report.inputs, { path: '@builder/build-extension.mjs', bytes: report.builderBytes, sha256: report.builderSha256 },
    marker('profile', report.profile), marker('edition', report.edition)].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (sha256(JSON.stringify(inputs)) !== report.identity.id.slice(7)) throw Error('Artifact input identity mismatch');
  return { directory: root, identity: report.identity, profile: report.profile, edition: report.edition, artifactSha256: report.artifactSha256, files: files.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length === 4 && process.argv[2] === '--verify') console.log(JSON.stringify(await verifyExtensionBuild(process.argv[3]), null, 2));
  else {
    const args = process.argv.slice(2), usage = 'Usage: node scripts/build-extension.mjs [--dev] [--viewer] [--site-origin https://example.com [--keep-issuer]] | --verify <artifact-directory>';
    let profile = 'release', edition = 'full', siteOrigin = null, keepIssuer = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dev' && profile === 'release') profile = 'dev';
      else if (args[i] === '--viewer' && edition === 'full') edition = 'viewer';
      else if (args[i] === '--site-origin' && siteOrigin === null && args[i + 1]) siteOrigin = args[++i];
      else if (args[i] === '--keep-issuer' && !keepIssuer) keepIssuer = true;
      else throw Error(usage);
    }
    const result = await buildExtension({ profile, edition, siteOrigin, keepIssuer });
    await verifyExtensionBuild(result.output);
    console.log(JSON.stringify({ output: result.output, profile, edition, identity: result.identity, artifactSha256: result.artifactSha256, files: result.files.length }, null, 2));
  }
}
