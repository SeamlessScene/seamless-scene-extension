import { downloadPercent, loadStatusMessage, mirroredLoadNotice } from './src/viewer-load-status.mjs';
import {
  STREAMING_ORIGINS,
  viewerFailureMessage,
  viewerFailureCode,
  siteAccessOrigins
} from './src/viewer-model.mjs';
import { viewerView, popupPlan, popupEditLine, chooserItems, findEditUrl, cleanPageTitle, downloadName, joinParts, popupAccountLine } from './src/viewer-display.mjs';
import { downloadActions } from './src/edits-model.mjs';
import { saveTimingReport, timingFailureMessage, timingSummary } from './src/timing-report-save.mjs';
import { RELEASE_INFO } from './src/release-info.mjs';
import { viewerRequest } from './src/viewer-client.mjs';
import { createViewerStore } from './src/viewer-store.mjs';
import { EDITION, EXECUTING_BUILD } from './src/build-info.mjs';
import { noteLinkIntent, pageStorage } from './src/link-intent.mjs';

// The toolbar popup and the Settings page share this script; each part renders only
// when its elements exist. The popup says what is playing and offers one main action;
// Settings holds preferences, account and site access, creator and advanced tools.
const $ = q => document.querySelector(q),
  store = createViewerStore();
let target = null,
  snapshot = null,
  closed = false,
  polling = false,
  siteOrigin = null,
  siteAllowed = null,
  currentPlan = null,
  currentView = null;
let commandActive = false,
  lastCommandError = null,
  lastCommandRelease = null,
  showingLoad = false,
  mirroredLoad = null,
  changing = false;
let targetRevision = 0,
  refreshQueued = false;
const message = text => {
  const el = $('#notice');
  if (el) el.textContent = text;
};
const CHIP_CLASS = { off: 'chip-off', ready: 'chip-ready', on: 'chip-on', bad: 'chip-bad' };
async function refresh() {
  if (closed || polling) return;
  polling = true;
  refreshQueued = false;
  const revision = targetRevision;
  try {
    if (target === null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (revision !== targetRevision) return;
      target = tab?.id ?? null;
    }
    try {
      const tab = await chrome.tabs.get(target);
      const origin = new URL(tab.url).origin;
      siteOrigin = STREAMING_ORIGINS.includes(origin) ? origin : null;
    } catch {
      siteOrigin = null;
    }
    if (revision !== targetRevision) return;
    const nextSnapshot = await viewerRequest('snapshot', { tabId: target });
    if (revision !== targetRevision) return;
    snapshot = nextSnapshot;
    target = snapshot.target ?? target;
    const { preferences: p, playback: s } = snapshot;
    renderDownloads(snapshot.downloads ?? [], snapshot.previouslyQueued ?? []);
    const progress = loadStatusMessage(snapshot.load);
    let wroteLoad = null;
    if (snapshot.load?.busy || showingLoad || commandActive || lastCommandError === 'viewer-busy') {
      if (progress && !$('#primary-action')) { message(progress); wroteLoad = progress; }
      else if (lastCommandError === 'viewer-busy' && !snapshot.load?.busy) {
        message('No edit is getting ready now. Try again.');
        lastCommandError = null;
      }
    }
    if (lastCommandError === 'viewer-busy' && snapshot.load && !snapshot.load.busy)
      lastCommandError = null;
    // A load that ended without a final line takes its progress line with it (Settings only).
    if (!$('#primary-action')) {
      const settled = mirroredLoadNotice(mirroredLoad, snapshot.load, wroteLoad, $('#notice')?.textContent ?? '');
      if (settled.text !== undefined) message(settled.text);
      mirroredLoad = settled.mirrored;
    }
    showingLoad = snapshot.load?.busy === true;
    document.documentElement.style.colorScheme = p.theme === 'system' ? 'light dark' : p.theme;
    for (const el of document.querySelectorAll('[data-preference]')) {
      if (el.type === 'checkbox') el.checked = p[el.dataset.preference];
      else el.value = String(p[el.dataset.preference]);
    }
    if ($('#creator')) $('#creator').hidden = p.mode !== 'creator' || snapshot.fixtureOnly;
    if ($('#player')) $('#player').hidden = !snapshot.fixtureOnly;
    if ($('#target-tab')) await renderTargets();
    if ($('#account')) renderAccount(snapshot.account);
    if ($('#permissions')) await renderSiteAccess();
    if ($('#creator-mode')) {
      $('#creator-mode').checked = p.mode === 'creator';
      $('#creator-hint').hidden = p.mode !== 'creator' || snapshot.targets?.length > 0;
    }
    if ($('#build') && !$('#build').children.length) renderBuild();
    if ($('#primary-action')) await renderPopup(p, s);
  } catch (e) {
    if (revision === targetRevision) message(viewerFailureMessage(e));
  } finally {
    polling = false;
    if (refreshQueued && !closed) void refresh();
  }
}

// ---- Popup -------------------------------------------------------------------
async function renderPopup(p, s) {
  siteAllowed = null;
  if (siteOrigin) {
    try {
      siteAllowed = await chrome.permissions.contains({ origins: [siteOrigin + '/*'] });
    } catch {}
  }
  $('#popup-version').textContent = snapshot.fixtureOnly
    ? `${EXECUTING_BUILD.version} · Private test build`
    : EXECUTING_BUILD.version;
  // E96: which account this browser is linked to, as Settings → Account & sites names it.
  const accountLine = $('#popup-account');
  if (accountLine) {
    accountLine.textContent = snapshot.fixtureOnly ? '' : popupAccountLine(snapshot.account);
    accountLine.hidden = !accountLine.textContent;
  }
  $('#update-strip').hidden = !snapshot.update;
  if (snapshot.update) $('#update-text').textContent = `Update ${snapshot.update.version} is ready`;
  const problem = lastCommandError && lastCommandError !== 'viewer-busy' ? lastCommandError : null;
  const view = viewerView({ playback: s, matches: snapshot.matches ?? [], load: snapshot.load, prefs: p, problem,
    problemReleaseId: problem ? lastCommandRelease : null });
  const plan = popupPlan(view, {
    account: snapshot.account,
    siteAllowed,
    onSupportedSite: Boolean(siteOrigin),
    fixtureOnly: snapshot.fixtureOnly
  });
  currentView = view;
  currentPlan = plan;
  $('#now-show').textContent =
    view.show ||
    (s.state === 'unavailable'
      ? siteOrigin
        ? 'Prime Video'
        : snapshot.fixtureOnly
          ? 'Test player'
          : 'No video in this tab'
      : 'This episode');
  const chip = $('#now-chip');
  chip.textContent = view.chip.text;
  chip.className = `state-chip ${CHIP_CLASS[view.chip.tone] ?? 'chip-off'}`;
  $('#now-edit').textContent = popupEditLine(view);
  $('#step-detail').textContent = plan.sub ?? view.popupSub ?? '';
  const busy = commandActive || snapshot.load?.busy === true;
  const primary = $('#primary-action');
  primary.hidden = !plan.main;
  if (plan.main) {
    primary.textContent = plan.main.label;
    primary.className = plan.main.quiet ? '' : 'primary';
    primary.disabled = busy;
  }
  const row = $('#second-row'),
    rowKey = JSON.stringify(plan.row.map(b => [b.act, b.label, b.disabled, b.title, busy]));
  if (row.dataset.key !== rowKey) {
    row.dataset.key = rowKey;
    row.replaceChildren(
      ...plan.row.map(b => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = b.label;
        button.dataset.act = b.act;
        if (b.title) button.title = b.title;
        button.disabled = busy || b.disabled === true;
        button.onclick = () => act(b.act, button);
        return button;
      })
    );
  }
  row.hidden = !plan.row.length;
  renderChooser($('#edit-list'), plan.list ? snapshot.matches : [], busy);
  $('#edit-list').hidden = !plan.list;
  if (changing && !plan.row.some(b => b.act === 'change')) changing = false;
  renderChooser($('#change-list'), changing ? snapshot.matches : [], busy, s.editId);
  $('#change-panel').hidden = !changing;
}
function renderChooser(list, matches, busy, currentId = '') {
  const key = JSON.stringify([matches.map(x => [x.id, x.name, x.version, x.bytes]), currentId]);
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren();
    for (const item of chooserItems(matches)) {
      const li = document.createElement('li'),
        label = document.createElement('span'),
        detail = document.createElement('small'),
        watch = document.createElement('button');
      label.textContent = `${item.name}${item.version ? ` · ${item.version}` : ''}`;
      detail.textContent = item.detail;
      if (item.detail) label.append(detail);
      watch.textContent = item.id === currentId ? 'On' : 'Watch';
      watch.className = item.id === currentId ? '' : 'primary';
      watch.dataset.current = String(item.id === currentId);
      watch.onclick = () => {
        changing = false;
        void runCommand({ command: 'watch', releaseId: item.id }, 'Turning the edit on…', watch);
      };
      li.append(label, watch);
      list.append(li);
    }
  }
  for (const button of list.querySelectorAll('button'))
    button.disabled = busy || button.dataset.current === 'true';
}
function openWebsite(url) {
  if (!url) throw Error('viewer-website-unconfigured');
  return chrome.tabs.create({ url });
}
// The account page's address never changes (the device-link service checks it exactly); a "Link your account"
// press is passed along as a short-lived note instead, so the page can carry on to the website by itself.
function openAccountPage({ link = false } = {}) {
  if (link) noteLinkIntent(pageStorage());
  return chrome.tabs.create({ url: chrome.runtime.getURL('catalog-account.html') });
}
function act(name, button) {
  const s = snapshot?.playback ?? {};
  if (name === 'link') return void openAccountPage({ link: true });
  if (name === 'allow-site') return allowSite();
  if (name === 'find')
    return void Promise.resolve()
      .then(() =>
        currentView?.kind === 'finished'
          ? runCommand({ command: 'find-another' }, 'Opening the website…', button)
          : openWebsite(findEditUrl(snapshot?.websiteOrigin, s.show, s.title))
      )
      .catch(e => message(viewerFailureMessage(e)));
  if (name === 'watch')
    return void runCommand(
      currentView?.armDirect
        ? { command: 'arm' }
        : { command: 'watch', ...(currentPlan?.main?.releaseId ? { releaseId: currentPlan.main.releaseId } : {}) },
      'Turning the edit on…',
      button
    );
  if (name === 'stop') return void runCommand({ command: 'stop' }, 'Stopping the edit…', button);
  if (name === 'again' || name === 'jump-first')
    return void runCommand({ command: 'jump-scene', index: 0 }, 'Jumping to scene 1…', button);
  if (name === 'next') return void runCommand({ command: 'next-scene' }, 'Jumping to the next scene…', button);
  if (name === 'change') {
    changing = !changing;
    refreshQueued = true;
    return void refresh();
  }
  if (name === 'reload') return void chrome.tabs.reload(target).catch(e => message(viewerFailureMessage(e)));
  if (name === 'library' || name === 'local') return void viewerRequest('open-settings', { tabId: target, section: name }).catch(e => message(viewerFailureMessage(e)));
}
async function runCommand(args, busy, button) {
  if (commandActive) return;
  commandActive = true;
  lastCommandError = null;
  if (button) button.disabled = true;
  message(busy);
  try {
    const result = await viewerRequest('command', {
      tabId: target,
      generation: snapshot?.playback?.generation,
      ...args
    });
    message(result?.message ?? 'Done.');
  } catch (e) {
    lastCommandError = viewerFailureCode(e) === 'unknown' ? 'viewer-operation-failed' : viewerFailureCode(e);
    lastCommandRelease = typeof args.releaseId === 'string' ? args.releaseId : null;
    message(snapshot?.playback && ['armed', 'active', 'paused'].includes(snapshot.playback.state) ? viewerFailureMessage(e) : '');
  } finally {
    commandActive = false;
    if (button) button.disabled = false;
    void refresh();
  }
}
if ($('#primary-action'))
  $('#primary-action').onclick = () => {
    const main = currentPlan?.main;
    // Chrome only asks for site access from inside the click itself.
    if (main) act(main.act, $('#primary-action'));
  };
if ($('#find-more'))
  $('#find-more').onclick = () =>
    void Promise.resolve()
      .then(() => openWebsite(findEditUrl(snapshot?.websiteOrigin, snapshot?.playback?.show, snapshot?.playback?.title)))
      .catch(e => message(viewerFailureMessage(e)));
if ($('#update-get'))
  $('#update-get').onclick = () =>
    void Promise.resolve()
      .then(() => openWebsite(snapshot?.websiteOrigin ? new URL('/install', snapshot.websiteOrigin).href : null))
      .catch(e => message(viewerFailureMessage(e)));

// ---- Shared controls -----------------------------------------------------------
function bind(selector, fn) {
  const el = $(selector);
  if (el)
    el.addEventListener('click', () => {
      el.disabled = true;
      void Promise.resolve()
        .then(fn)
        .catch(e => message(viewerFailureMessage(e)))
        .finally(() => {
          el.disabled = false;
          void refresh();
        });
    });
}
bind('#library', () => viewerRequest('open-settings', { tabId: target, section: 'library' }));
bind('#settings', () => viewerRequest('open-settings', { tabId: target, section: 'playback' }));
bind('#account-manage', () =>
  openAccountPage({ link: $('#account-manage').textContent === 'Connect your account' })
);
bind('#player', () => chrome.tabs.create({ url: chrome.runtime.getURL('catalog-fixture.html') }));
bind('#portal', () => openWebsite(snapshot?.websiteOrigin));
// Gesture-gated Chrome API must be invoked directly by its click handler. From
// Settings the side panel opens for the Prime player tab, which is brought forward.
if ($('#creator'))
  $('#creator').onclick = () => {
    const tabId = snapshot?.target ?? target;
    if (!Number.isInteger(tabId)) {
      message('Open a Prime Video title first; Creator tools open beside it.');
      return;
    }
    // Creator tools are enabled per Prime tab; enable this one in the same gesture in case
    // Creator mode was switched on a moment ago (the service worker catches up after).
    void Promise.resolve(chrome.sidePanel.setOptions?.({ tabId, path: 'authoring-sidepanel.html', enabled: true })).catch(() => {});
    // From the toolbar popup, close it once the panel is open so it no longer
    // sits over the panel (E59 C5). Settings stays open.
    const fromPopup = document.body?.classList?.contains('popup') === true;
    void chrome.sidePanel.open({ tabId }).then(() => { if (fromPopup) window.close(); }, e => message(viewerFailureMessage(e)));
    if ($('#primary-action')) return;
    void chrome.tabs
      .update(tabId, { active: true })
      .then(tab => chrome.windows?.update(tab.windowId, { focused: true }))
      .catch(() => {});
  };
for (const el of document.querySelectorAll('[data-preference]'))
  el.onchange = () => {
    const value = el.type === 'checkbox' ? el.checked : el.dataset.number ? Number(el.value) : el.value;
    void viewerRequest('preferences', { [el.dataset.preference]: value }).then(refresh, e =>
      message(viewerFailureMessage(e))
    );
  };
if ($('#creator-mode'))
  $('#creator-mode').onchange = () =>
    void viewerRequest('preferences', { mode: $('#creator-mode').checked ? 'creator' : 'viewer' }).then(
      refresh,
      e => message(viewerFailureMessage(e))
    );
if ($('#reset')) {
  $('#reset').onclick = () => {
    $('#reset-confirm').hidden = false;
    $('#reset').hidden = true;
    $('#reset-no').focus();
  };
  $('#reset-no').onclick = () => {
    $('#reset-confirm').hidden = true;
    $('#reset').hidden = false;
    $('#reset').focus();
  };
  bind('#reset-yes', async () => {
    await viewerRequest('reset');
    $('#reset-confirm').hidden = true;
    $('#reset').hidden = false;
    message('All settings were reset.');
  });
}
for (const b of document.querySelectorAll('[data-folder]'))
  b.onclick = () => {
    void (async () => {
      if (!globalThis.showDirectoryPicker) throw Error('viewer-folder-picker-unavailable');
      const h = await showDirectoryPicker({
        id: 'ss-' + b.dataset.folder,
        mode: b.dataset.folder === 'exports' ? 'readwrite' : 'read'
      });
      await store.folder(b.dataset.folder, h);
      $('#folders').textContent = 'Folder saved. Access is checked when used.';
    })().catch(e => message(e.name === 'AbortError' ? 'Folder selection cancelled.' : viewerFailureMessage(e)));
  };
bind('#forget-folders', async () => {
  await store.folder('imports', null);
  await store.folder('exports', null);
  $('#folders').textContent = 'Folder choices forgotten. Files were not deleted.';
});
const allowSite = () => {
  if (!siteOrigin) {
    message(viewerFailureMessage(Error('viewer-site-unsupported')));
    return;
  }
  const tabId = target,
    access = chrome.permissions.request({ origins: siteAccessOrigins(siteOrigin) });
  void access
    .then(async granted => {
      if (!granted) throw Error('viewer-site-not-allowed');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: EDITION === 'viewer' ? ['bootstrap.js'] : ['bootstrap.js', 'authoring-page-bridge.js']
      });
      message('Prime Video allowed. Press play on a title.');
      await refresh();
    })
    .catch(e => message(viewerFailureMessage(e)));
};
const site = $('#enable-site');
if (site)
  site.onclick = () => {
    // Settings asks for Prime Video itself; no player tab needs to be open.
    void chrome.permissions
      .request({ origins: siteAccessOrigins('https://www.amazon.com') })
      .then(granted => {
        message(granted ? 'Prime Video allowed. Press play on a title.' : viewerFailureMessage(Error('viewer-site-not-allowed')));
        return refresh();
      })
      .catch(e => message(viewerFailureMessage(e)));
  };

// ---- Settings ------------------------------------------------------------------
function renderAccount(a) {
  $('#account').textContent =
    a?.state === 'saved'
      ? `Connected as ${a.displayName} until ${new Date(a.expiresAt).toLocaleString()}. The website confirms the connection each time you open an edit.`
      : a?.state === 'pending'
        ? 'A connection is waiting for you to confirm on the website.'
        : a?.state === 'revocation-pending'
          ? 'Disconnected on this device; the website has not confirmed yet.'
          : a?.state === 'unpaired' || a?.state === 'session-only'
            ? 'Not connected. Connect your account to watch website edits.'
            : 'Connecting an account is not set up for this build.';
  $('#account-manage').textContent = a?.state === 'saved' ? 'Manage account connection' : 'Connect your account';
  // Unlinked is the one state where this button is the next thing to do, so it reads as the main action.
  $('#account-manage').classList?.toggle('primary', ['unpaired', 'session-only', 'pending'].includes(a?.state));
}
async function renderSiteAccess() {
  let allowed = null;
  try {
    allowed = await chrome.permissions.contains({ origins: siteAccessOrigins('https://www.amazon.com') });
  } catch {}
  $('#permissions').textContent =
    allowed === true ? 'Prime Video: allowed ✓' : allowed === false ? 'Prime Video: not allowed yet' : 'Prime Video: unknown';
  $('#permissions').dataset.allowed = String(allowed === true);
  $('#enable-site').hidden = allowed === true || snapshot.fixtureOnly;
}
// Connected players are listed by their title, never by Chrome's tab number.
async function renderTargets() {
  const el = $('#target-tab'),
    targets = snapshot.targets ?? [],
    selected = String(target ?? '');
  const titles = await Promise.all(
    targets.map(id =>
      chrome.tabs.get(id).then(
        tab => cleanPageTitle(tab?.title ?? '') || 'Prime Video player',
        () => 'Prime Video player'
      )
    )
  );
  const labels = titles.map((title, i) => (titles.indexOf(title) !== i || titles.lastIndexOf(title) !== i ? `${title} (${i + 1})` : title));
  const inventory = JSON.stringify([targets, labels]),
    changed = el.dataset.inventory !== inventory;
  if (changed) {
    const options = targets.map((id, i) => {
      const option = document.createElement('option');
      option.value = String(id);
      option.textContent = labels[i];
      return option;
    });
    el.replaceChildren(...options);
    el.dataset.inventory = inventory;
  }
  // An open native menu may hold a choice before its change event. Idle
  // polling must not replace its nodes or write the prior selection back.
  if (changed || el.dataset.target !== selected) el.value = selected;
  el.dataset.target = selected;
  if ($('#target-label')) $('#target-label').hidden = targets.length < 2;
}
const shortBuild = id => String(id ?? '').replace(/^sha256:/, '').slice(0, 12);
function renderBuild() {
  for (const [label, value] of [
    ['Version', EXECUTING_BUILD.version],
    ['Channel', snapshot.fixtureOnly ? 'Private test build' : 'Standard build'],
    ['Build ID', shortBuild(EXECUTING_BUILD.id) || 'source checkout (not a packaged build)'],
    ['Built', RELEASE_INFO.builtAt]
  ]) {
    const dt = document.createElement('dt'),
      dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value ?? '—';
    $('#build').append(dt, dd);
  }
}
bind('#copy-build', () =>
  navigator.clipboard
    .writeText(`${EXECUTING_BUILD.version} · ${EXECUTING_BUILD.id}`)
    .then(() => message('Build ID copied.'))
);
// 0.62.21: the result, or the reason nothing was saved, is shown beside the
// buttons (the page notice is out of view down here) as well as in the notice.
const timingStatus = text => {
  message(text);
  const el = $('#timing-status');
  if (el) el.textContent = text;
};
const timingReport = () => viewerRequest('timing-report', { tabId: target });
const playerTitle = async () => {
  try { return cleanPageTitle((await chrome.tabs.get(snapshot?.target ?? target))?.title ?? ''); } catch { return ''; }
};
bind('#copy-timing', async () => {
  let report;
  try { report = await timingReport(); } catch (error) { timingStatus(timingFailureMessage(error)); return; }
  if (!report?.transitionCount) { timingStatus(timingFailureMessage(Error('viewer-timing-empty'))); return; }
  await navigator.clipboard.writeText(JSON.stringify(report));
  timingStatus(`${timingSummary(report)} Report copied.`);
});
bind('#save-timing', async () => {
  const result = await saveTimingReport({ read: timingReport, document, where: await playerTitle() });
  timingStatus(result.message);
});
const diagnosticsReport = async () => ({
  schema: 1,
  build: EXECUTING_BUILD,
  channel: snapshot?.fixtureOnly ? 'fixture' : 'normal',
  playback: snapshot?.playback.state,
  notice: snapshot?.playback.notice || null,
  load: snapshot?.load ?? null,
  downloads: (snapshot?.jobs ?? snapshot?.downloads ?? []).map(j => ({
    release: String(j.releaseId).slice(0, 8),
    state: j.state,
    error: j.error ?? null,
    cause: j.cause ?? null,
    bytes: j.bytes,
    total: j.total,
    // E61: per-download telemetry (no names): rate, attempts, automatic retries after
    // stalls, client reconnects (HTTP Range resumes) and the queue position.
    bytesPerSecond: j.bytesPerSecond ?? null,
    attempts: j.attempts ?? null,
    stalls: j.stalls ?? 0,
    autoRetries: j.autoRetries ?? 0,
    transferRetries: j.transferRetries ?? 0,
    lastRetryCode: j.lastRetryCode ?? null,
    ahead: j.ahead ?? null
  })),
  downloadHistory: snapshot?.downloadHistory ?? null,
  downloadStats: snapshot?.downloadStats ?? null,
  loadStalls: snapshot?.loadStalls ?? null,
  commandFailures: snapshot?.commandFailures ?? null,
  // The player's source key beside each kept edit's recorded key (E51).
  sourceCheck: snapshot?.sourceCheck ?? null,
  account: snapshot?.account?.state ?? null,
  connection: await viewerRequest('connection-report', { tabId: target }).catch(() => null)
});
bind('#copy-diagnostics', async () => {
  await navigator.clipboard.writeText(JSON.stringify(await diagnosticsReport(), null, 2));
  message('Diagnostics copied.');
});
bind('#save-diagnostics', async () => {
  const report = await diagnosticsReport(),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    ),
    a = document.createElement('a');
  a.href = url;
  a.download = `scene-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  message('Diagnostics saved to Downloads.');
});
const timer = setInterval(refresh, 1500);
addEventListener(
  'pagehide',
  () => {
    closed = true;
    clearInterval(timer);
  },
  { once: true }
);
void refresh();

if ($('#target-tab'))
  $('#target-tab').onchange = () => {
    target = Number($('#target-tab').value);
    targetRevision++;
    refreshQueued = true;
    void refresh();
  };

// Background downloads in the popup: the same wording, percentage and controls as the
// Library (E61). A download is named after its edit, else its title and episode; only
// with nothing known (the website could not be asked yet) does it read "Edit from the website".
// 0.63.2: failed rows have Clear (and Clear all); stale downloads show once as "Previously queued".
const popupButton = (text, onClick) => {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'download-control';
  control.textContent = text;
  control.onclick = () => void Promise.resolve().then(onClick).then(() => refresh(), e => { message(viewerFailureMessage(e)); return refresh(); });
  return control;
};
function renderDownloads(downloads, previous = []) {
  const section = document.querySelector('#popup-downloads'),
    list = document.querySelector('#popup-download-list');
  if (!section || !list) return;
  section.hidden = !downloads.length && !previous.length;
  list.replaceChildren();
  for (const p of previous) {
    const li = document.createElement('li');
    li.className = 'download status-previous';
    const name = document.createElement('strong');
    name.textContent = joinParts(p.name) || joinParts(p.titleName, p.episodeName) || 'An edit';
    li.append('Previously queued: ', name, ' ',
      popupButton('Download again', () => viewerRequest('watch-intent', { releaseId: p.releaseId })), ' ',
      popupButton('Clear', () => viewerRequest('previous-clear', { releaseId: p.releaseId })));
    list.append(li);
  }
  if (downloads.filter(d => d.state === 'failed').length > 1) {
    const li = document.createElement('li');
    li.append(popupButton('Clear all failed', () => viewerRequest('download-control', { action: 'clear-all' })));
    list.append(li);
  }
  for (const d of downloads) {
    const li = document.createElement('li');
    li.className = `download status-${d.state === 'failed' ? 'failed' : d.state === 'paused' ? 'paused' : 'downloading'}`;
    const name = document.createElement('strong');
    name.textContent = downloadName(d) || 'Edit from the website';
    // E89: the name and status flow as one piece of text, and the separator only joins parts that exist.
    const text = document.createElement('span');
    text.className = 'download-text';
    const label = joinParts(loadStatusMessage(d) ?? '');
    text.append(name, ...(label ? [' · ', label] : []));
    li.append(text);
    const percent = d.state === 'failed' ? null : downloadPercent(d);
    for (const [act, text] of [['pause', 'Pause'], ['resume', 'Resume'], ['retry', 'Retry'], ['cancel', 'Cancel'], ['clear', 'Clear']]) {
      if (!downloadActions(d).includes(act)) continue;
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'download-control';
      control.textContent = text;
      control.onclick = () => void viewerRequest('download-control', { action: act, releaseId: d.releaseId }).then(() => refresh(), () => refresh());
      li.append(' ', control);
    }
    if (d.state !== 'failed' && d.state !== 'paused') {
      const bar = document.createElement('progress');
      if (percent !== null) {
        bar.max = 100;
        bar.value = percent;
      }
      bar.setAttribute('aria-label', 'Download progress');
      li.append(bar);
    }
    list.append(li);
  }
}
