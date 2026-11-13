import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RULES } from '../src/seamless-rules.mjs';
import { readEditJson } from '../src/ss-normalize.mjs';
import { previewPacket } from '../src/preview-packet.mjs';
import { sourceKey } from '../src/viewer-model.mjs';
import { writeSsArchive, readSsArchive } from '../src/ss-archive.mjs';
import { validateLocalUserEditPacket } from '../src/local-edit-packet.mjs';
import { ConnectionDiagnostics, disconnectNotice, disconnectSummary, safeConnectionReport } from '../src/connection-diagnostics.mjs';
import { localPacket } from './helpers/ss-fixture.mjs';

// 0.65.4 (owner, 2026-10-19; proposals/edit-pack-tier-default-2026-10-18.md): an edit pack that
// gives no tier says "unverified", never a guessed "ad-free". Local files only: the catalog keeps
// its two tiers. And a lost private renderer names its recorded reason.
const EPISODE = { gti: 'amzn1.dv.gti.e68bf607-fa00-4db4-8f9e-3aa6d04a27f9', show: 'Synthetic Show', season: 1, episode: 2, runtime_ms: 1_800_000 };
const edit = episode => ({ id: 'tier-unverified', episode: { ...EPISODE, ...episode }, scenes: [{ action: 'REPLACE', start: 300_000, end: 302_000, clip: 'clips/a.mp4' }] });
const entries = new Map([['clips/a.mp4', {}]]);

test('an absent tier is "unverified"; a stated one is kept; the catalog keeps two tiers', () => {
  assert.equal(readEditJson(edit({}), entries).source.service_tier, 'unverified');
  for (const tier of ['ad-free', 'ad-supported', 'unverified']) assert.equal(readEditJson(edit({ tier }), entries).source.service_tier, tier);
  assert.throws(() => readEditJson(edit({ tier: 'premium' }), entries), e => e.errors?.includes('episode.tier must be "ad-free" or "ad-supported" or "unverified"'));
  assert.deepEqual(RULES.source.tiers, ['ad-free', 'ad-supported'], 'catalog tiers unchanged');
  assert.deepEqual(RULES.source.local_tiers, ['ad-free', 'ad-supported', 'unverified']);
  assert.equal(RULES.source.local_default_tier, 'unverified');
});

test('a local .ss saying "unverified" is written and read back, with no newer min_extension', async () => {
  const { packet, clips } = localPacket({ count: 1 });
  packet.manifest.source.service_tier = 'unverified';
  assert.equal(validateLocalUserEditPacket(packet).ok, true);
  const { blob } = await writeSsArchive({ packet, clips, createdAt: '2026-10-19T12:00:00.000Z', generator: 'test' });
  const read = await readSsArchive(blob);
  assert.equal(read.packet.manifest.source.service_tier, 'unverified');
  assert.equal(read.header.min_extension, RULES.archive.min_extension, '0.65.3 and older already read any tier id');
});

test('a Prime preview (no plan reported) says "unverified", not "ad-free"', () => {
  const key = sourceKey({ serviceId: 'prime-video', activeItemId: 'amzn1.dv.gti.example', mediaType: 'episode', season: 1, episode: 3, runtimeMs: 2_967_368, versionTag: null, territory: null, plan: null });
  const asset = { sha256: 'a'.repeat(64), expected_duration_ms: 12_000, container: 'video/mp4', video_codec: 'avc1', audio_codec: 'mp4a', width: 1920, height: 1080, dynamic_range: 'sdr' };
  const packet = previewPacket({ sourceKey: key, title: 'Example', scene: { action: 'REPLACE', startMs: 61_250, resumeMs: 75_500 }, asset, id: '11111111-2222-4333-8444-555555555555', now: new Date('2026-10-19T00:00:00Z') });
  assert.equal(packet.manifest.source.service_tier, 'unverified');
});

test('a lost renderer names the recorded reason: the cause, and the last attempt when it differs', () => {
  const event = (component, reason) => ({ sequence: 1, elapsedMs: 10, component, reason, leaseAgeMs: null, visibility: 'visible' });
  assert.equal(disconnectSummary(event('relay', 'handshake-timeout'), event('relay', 'handshake-timeout')), 'relay handshake-timeout');
  assert.equal(disconnectSummary(event('relay', 'handshake-rejected'), event('controller', 'reconnect-failed')), 'relay handshake-rejected; last attempt: controller reconnect-failed');
  assert.equal(disconnectSummary(event('controller', 'frame-owner-lost')), 'controller frame-owner-lost');
  assert.equal(disconnectSummary(null, event('controller', 'reconnect-failed')), 'controller reconnect-failed');
  assert.equal(disconnectSummary(null, null), null);
  assert.equal(disconnectSummary(event('relay', '<script>'), null), null, 'only the fixed reason codes are ever shown');
  assert.equal(disconnectSummary({ component: 'relay', reason: 'handshake-timeout' }), 'relay handshake-timeout');
});

test('Copy diagnostics carries the same reasons (the connection report keeps component and reason)', () => {
  const diagnostics = new ConnectionDiagnostics({ now: () => 0 });
  diagnostics.record(disconnectNotice('relay', 'handshake-timeout', { visibility: 'visible' }));
  diagnostics.record(disconnectNotice('controller', 'reconnect-failed', { visibility: 'visible' }));
  const report = safeConnectionReport({ ...diagnostics.snapshot(), state: 'disconnected' });
  assert.deepEqual(report.events.map(e => [e.component, e.reason]), [['relay', 'handshake-timeout'], ['controller', 'reconnect-failed']]);
  assert.equal(disconnectSummary(report.events[0], report.events.at(-1)), 'relay handshake-timeout; last attempt: controller reconnect-failed');
});

test('the panel shows the reason only on the lost path; reconnect behaviour is unchanged', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /const cause = primeTransitionOverlay\.diagnostics\?\.\(\)\?\.events\?\.at\(-1\) \?\? null;/u);
  assert.match(main, /panelHost\.dataset\.rendererConnection = 'lost';\n\s+const reason = disconnectSummary\(cause, /u);
  assert.match(main, /packetOutput\.textContent = `Private renderer disconnected; edits stopped\. Refresh this tab\.\$\{reason \? ` \(Reason: \$\{reason\}\.\)` : ''\}`;/u);
  assert.match(main, /delete panelHost\.dataset\.rendererReason;/u, 'a reconnect clears it');
  assert.match(main, /\.then\(\(\) => primeTransitionOverlay\.reconnect\(\{ signal: lifecycleAbort\.signal \}\)\)/u, 'the same reconnect');
  const overlay = await readFile(new URL('../src/private-local-overlay.mjs', import.meta.url), 'utf8');
  assert.match(overlay, /async reconnect\(\{ signal, attempts = 5, firstDelayMs = 1000 \} = \{\}\)/u, 'five attempts from 1 s, as in 0.65.3');
});
