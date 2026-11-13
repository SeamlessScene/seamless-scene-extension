// The developer panel (formerly "Local playback controls"): shown only in Advanced
// mode (Settings → Advanced), from a small "Developer" launcher. Markup and styles
// only; src/main.mjs owns the behaviour behind every data-* hook. The host stays in
// the page while hidden because the private picker frame it holds also renders edits.

// Same dark tokens as the player menu; 12.5–14 px text.
const TOKENS = `--x-scrim: rgba(13,19,16,.96); --x-line: #2b3731; --x-ink: #eef3ef; --x-muted: #a6b4ac; --x-faint: #71807a;
  --x-on: #2f9e6a; --x-on-ink: #06140d; --x-ready: #8fd3b0; --x-btn: #1c2723; --x-btn-h: #24322c; --x-bad: #f2a39c;`;

export const DEVELOPER_PANEL_HTML = `
    <style>
      :host { all: initial; display: none !important; }
      :host([data-advanced="true"][data-playback-controls="visible"]) { display: block !important; position: fixed; left: 18px; bottom: 64px; z-index: 2147483647; max-height: 75vh; overflow: auto; font: 13.5px/1.45 system-ui, sans-serif; border-radius: 14px; ${TOKENS} }
      section { box-sizing: border-box; width: 360px; padding: 14px; border: 1px solid var(--x-line); border-radius: 14px; background: var(--x-scrim); color: var(--x-ink); box-shadow: 0 12px 40px rgb(0 0 0 / 45%); display: grid; gap: 10px; }
      header { display: flex; align-items: center; gap: 8px; }
      h2 { margin: 0; font-size: 14px; font-weight: 650; flex: 1; }
      .tag { font: 700 11px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; padding: 5px 7px; border-radius: 6px; background: #2a2410; color: #f0cf87; }
      p { margin: 0; color: var(--x-muted); font-size: 13px; }
      [data-summary] { color: var(--x-ink); font-size: 13.5px; overflow-wrap: anywhere; }
      details { border-top: 1px solid var(--x-line); padding-top: 8px; }
      summary { cursor: pointer; font-weight: 600; font-size: 13.5px; list-style-position: inside; }
      summary small { font-weight: 400; color: var(--x-faint); font-size: 12.5px; margin-left: 4px; }
      .body { display: grid; gap: 8px; margin-top: 8px; }
      h3 { margin: 6px 0 0; font: 600 11px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--x-muted); }
      dl { display: grid; grid-template-columns: 1fr 1.4fr; gap: 4px 10px; margin: 0; font-size: 12.5px; }
      dt { color: var(--x-muted); } dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--x-ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
      .actions { display: flex; gap: 7px; flex-wrap: wrap; }
      button { font: inherit; font-size: 13px; min-height: 32px; border: 1px solid var(--x-line); border-radius: 8px; padding: 5px 10px; color: var(--x-ink); background: var(--x-btn); cursor: pointer; }
      button:hover:not(:disabled) { background: var(--x-btn-h); }
      button.primary { background: var(--x-on); border-color: var(--x-on); color: var(--x-on-ink); font-weight: 600; }
      button:disabled { cursor: not-allowed; opacity: .45; }
      button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--x-ready); outline-offset: 2px; }
      button[hidden], [data-command-controls][hidden] { display: none; }
      output { display: block; min-height: 16px; color: var(--x-ready); font-size: 12.5px; overflow-wrap: anywhere; }
      [data-command-controls] { display: flex; flex-wrap: wrap; gap: 7px; }
      [data-trial-controls] { margin: 0; padding: 8px 0 0; border: 0; border-top: 1px solid var(--x-line); }
      [data-trial-controls][hidden] { display: none; }
      [data-trial-controls] legend { padding: 0; color: var(--x-muted); font-size: 12.5px; font-weight: 700; }
      .trial-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 8px; }
      .trial-fields label { color: var(--x-muted); font-size: 12.5px; }
      .trial-fields input, .trial-fields select, .lead-in input { box-sizing: border-box; width: 100%; margin-top: 3px; border: 1px solid var(--x-line); border-radius: 6px; padding: 4px 6px; color: var(--x-ink); background: #0f1512; font: inherit; font-size: 13px; }
      .trial-note { font-size: 12.5px; }
      [data-trial-summary] { font-size: 12.5px; }
      [data-packet-controls] { margin: 0; padding: 0; border: 0; min-width: 0; }
      [data-packet-controls] .actions { flex-wrap: wrap; }
      [data-private-picker] { flex: 1 0 100%; min-width: 0; }
      [data-packet-navigation][hidden] { display: none; }
      .lead-in { display: flex; align-items: center; gap: 7px; color: var(--x-muted); font-size: 13px; }
      .lead-in input { width: 64px; margin: 0; }
      [data-navigation-list] { display: grid; gap: 3px; max-height: 220px; overflow: auto; }
      [data-navigation-list] button { width: 100%; display: grid; grid-template-columns: 24px 1fr auto; gap: 8px; text-align: left; border-color: transparent; background: transparent; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
      [data-navigation-list] button:hover:not(:disabled) { background: var(--x-btn-h); }
      [data-navigation-list] .n { color: var(--x-muted); text-align: center; }
      [data-navigation-list] .j { color: var(--x-faint); }
    </style>
    <section aria-label="Developer panel">
      <header><h2>Developer panel</h2><span class="tag">Advanced mode</span><button data-action="close" type="button">Close</button></header>
      <p data-summary>No edit loaded · Off</p>
      <details data-section="scenes" open>
        <summary>Scenes <small>jump with lead-in</small></summary>
        <div class="body">
          <p data-scenes-empty>Load a test edit to list its scenes.</p>
          <div data-packet-navigation hidden>
            <label class="lead-in">Lead-in <input data-preroll-seconds type="number" min="0" max="30" step="0.5" value="5"> s</label>
            <div data-navigation-list></div>
            <output data-navigation-output aria-live="polite">Choose a scene to jump to its lead-in.</output>
          </div>
        </div>
      </details>
      <details data-section="load">
        <summary>Load a test edit <small>folder or website release ID</small></summary>
        <div class="body">
          <fieldset data-packet-controls>
            <div class="actions">
              <div data-private-picker></div>
              <button data-action="arm-local-packet" class="primary" type="button" disabled>Watch with edit</button>
              <button data-action="cancel-local-packet" type="button" disabled>Stop edit</button>
            </div>
            <output data-packet-output aria-live="polite">Choose a folder containing edit-packet.json and its local MP4 clips.</output>
          </fieldset>
        </div>
      </details>
      <details data-section="readings">
        <summary>Player readings <small>identity · playback · media</small></summary>
        <div class="body">
          <output data-identity-output>Reading the Prime identity…</output>
          <h3>Identity</h3>
          <dl>
            <dt>Service</dt><dd data-field="service">—</dd>
            <dt>Route candidate</dt><dd data-field="routeCandidateId">—</dd>
            <dt>Active item ID</dt><dd data-field="activeItemId">—</dd>
            <dt>Media type</dt><dd data-field="privateMediaType">not read yet</dd>
            <dt>Episode</dt><dd data-field="privateEpisode">not read yet</dd>
            <dt>Source check</dt><dd data-field="versionEvidence">unavailable</dd>
            <dt>Title</dt><dd data-field="title">—</dd>
            <dt>Confidence</dt><dd data-field="confidence">—</dd>
          </dl>
          <h3>Playback</h3>
          <dl>
            <dt>Player</dt><dd data-field="player">—</dd>
            <dt>Lifecycle</dt><dd data-field="lifecycle">—</dd>
            <dt>Runtime</dt><dd data-field="runtime">—</dd>
            <dt>Current</dt><dd data-field="time">—</dd>
            <dt>Paused</dt><dd data-field="paused">—</dd>
            <dt>Buffering</dt><dd data-field="buffering">—</dd>
            <dt>Clock</dt><dd data-field="clock">—</dd>
          </dl>
          <h3>Media</h3>
          <dl>
            <dt>Muted / volume</dt><dd data-field="audio">—</dd>
            <dt>Ready state</dt><dd data-field="readyState">—</dd>
            <dt>Fullscreen</dt><dd data-field="fullscreen">—</dd>
          </dl>
          <div class="actions"><button data-action="refresh" type="button">Refresh readings</button></div>
        </div>
      </details>
      <details data-section="commands">
        <summary>Command tests <small>seek, nudge, cover</small></summary>
        <div class="body">
          <div class="actions"><button data-action="enable-commands" type="button">Enable Prime command tests</button></div>
          <div data-command-controls hidden>
            <button data-command="pause" type="button">Pause</button>
            <button data-command="play" type="button">Play</button>
            <button data-command="seek-backward" type="button">Seek −10s</button>
            <button data-command="seek-forward" type="button">Seek +10s</button>
            <button data-command="warm-seek-backward" type="button">Warm seek −10s</button>
            <button data-command="warm-seek-forward" type="button">Warm seek +10s</button>
            <button data-command="nudge-forward-1ms" type="button">Nudge +1ms</button>
            <button data-command="nudge-forward-10ms" type="button">Nudge +10ms</button>
            <button data-command="nudge-forward-100ms" type="button">Nudge +100ms</button>
            <label class="lead-in">Episode position <input data-seek-position type="number" min="0" step="1" inputmode="numeric" aria-label="Episode position in milliseconds"> ms</label>
            <button data-command="seek-position" type="button" title="One seek to this position, as the player's slider does: it also acts during an active or paused replacement">Seek to position</button>
            <button data-command="toggle-muted" type="button">Toggle mute</button>
            <button data-command="windowed-cover" type="button">Show 3s cover</button>
            <button data-command="fullscreen-cover" type="button">Arm fullscreen cover</button>
            <button data-command="local-replacement" type="button">Run 5s local replacement</button>
            <button data-action="cancel-transition" type="button">Cancel local cycle</button>
          </div>
          <output data-command-output>Active commands are disabled. Each command requires a separate click.</output>
          <fieldset data-trial-controls hidden>
            <legend>Local trial evidence</legend>
            <div class="trial-fields">
              <label>Opaque title slot<input data-trial-field="title-slot" value="unassigned" maxlength="40" pattern="[a-z0-9][a-z0-9_-]{0,39}"></label>
              <label>Content kind<select data-trial-field="content-kind"><option value="unknown">Unknown</option><option value="film">Film</option><option value="episodic">Episodic</option></select></label>
              <label>Network profile<select data-trial-field="network-profile"><option value="normal">Normal</option><option value="throttled">Throttled externally</option><option value="temporary-disconnect">Temporary disconnect</option></select></label>
              <label>Clip fixture<select data-trial-field="clip-duration"><option value="5000">5 seconds</option></select></label>
            </div>
            <p class="trial-note">Use labels such as episode-01. Do not enter a title, URL, content ID, or account information.</p>
            <div class="actions">
              <button data-action="export-trials" type="button">Export local evidence</button>
              <button data-action="clear-trials" type="button">Clear local evidence</button>
            </div>
            <output data-trial-summary aria-live="polite">0 local records</output>
          </fieldset>
        </div>
      </details>
      <details data-section="evidence">
        <summary>Evidence &amp; timing export</summary>
        <div class="body">
          <div class="actions">
            <button data-action="export-packet-evidence" type="button" disabled>Export playback evidence</button>
            <button data-action="export-scene-timing" type="button" disabled>Save scene timing report</button>
            <button data-action="export-engine-events" type="button" disabled>Save engine event log</button>
          </div>
          <p>Scene timing is recorded only while Settings → Advanced → Record scene timing is on. The engine event log is recorded while developer mode (Advanced) is on.</p>
        </div>
      </details>
    </section>`;

export const DEVELOPER_LAUNCHER_HTML = `<style>:host { all: initial; position: fixed; left: 18px; bottom: 18px; z-index: 2147483647; } button { font: 600 12.5px/1 system-ui, sans-serif; letter-spacing: .02em; background: rgba(13,19,16,.94); color: #eef3ef; border: 1px solid #2b3731; border-radius: 999px; padding: 8px 12px; cursor: pointer; } button:hover { background: #24322c; } button:focus-visible { outline: 3px solid #8fd3b0; outline-offset: 2px; } button[aria-expanded="true"] { border-color: #8fd3b0; }</style><button type="button" aria-expanded="false">Developer</button>`;

const TYPE_NAMES = Object.freeze({ REPLACE: 'Replaced', INSERT: 'Added', SKIP: 'Cut', MUTE: 'Muted' });
/** A developer scene row: number, plain type name and millisecond times. */
export function developerSceneRow(item) {
  return { number: String(item.ordinal), text: `${TYPE_NAMES[item.action] ?? item.action} · ${item.triggerLabel}`, jump: `jump ${item.targetLabel}` };
}

/** The panel's one-line summary: edit · state · progress · source check. The source check is the
 * last arm-time comparison (✓, or ✗ with its reason), not only whether Prime's identity is complete. */
export function developerSummary({ label = '', state = 'idle', scenes = [], sourceReady = false, sourceCheck = null } = {}) {
  const words = { unavailable: 'No player', idle: 'Off', loaded: 'Loaded, off', ready: 'Loaded, off', armed: 'On', active: 'On · playing', paused: 'On · paused', restoring: 'Restoring', finished: 'Finished', failed: 'Stopped' };
  const played = scenes.filter(scene => scene.status === 'played').length;
  return [label || 'No edit loaded', words[state] ?? state, scenes.length ? `${played} of ${scenes.length} played` : '', sourceCheck === 'compatible' ? 'source check ✓' : typeof sourceCheck === 'string' && /^[a-z-]{1,60}$/.test(sourceCheck) ? `source check ✗ ${sourceCheck}` : sourceReady ? 'source check not run yet' : 'source check …'].filter(Boolean).join(' · ');
}
