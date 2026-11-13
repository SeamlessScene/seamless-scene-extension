// Metadata only. IDs identify decoder lifetimes, never URLs or content IDs.
// Heartbeats bound observation; a suspended observer creates a gap.
export function createFrameTimingStream({ window, getPlayer, getGeneration = () => 0,
  getPresentation = () => ({ mode: 'video', heldMediaTime: null }),
  heartbeatTimer = null,
  clock = () => performance.timeOrigin + performance.now(), timeOrigin = performance.timeOrigin,
  maximumFrames = 12000, maximumStates = 2000, maximumHeartbeatGapMs = 100 }) {
  const frames = [], states = [], spans = [], losses = [], playback = [];
  const dropped = { frames: 0, states: 0, spans: 0, losses: 0, playback: 0 };
  let enabled = false, bound = null, generation = null, id = 0, token = 0;
  let callback = null, animation = null, lastTick = null, lastState = null, lastPlayback = null, previousFrame = null;
  let timer = null, observationGeneration = 0;
  const playbackEvents = ['pause', 'play', 'seeking', 'seeked', 'ended'];
  const round = (n, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
  const append = (name, list, value, limit) => {
    list.push(value);
    if (list.length > limit) { dropped[name] += list.length - limit; list.splice(0, list.length - limit); }
  };
  const changedSource = () => { generation = Symbol('source changed'); sample(); };
  function unbind() {
    token++;
    try { if (callback !== null) bound?.cancelVideoFrameCallback?.(callback); } catch {}
    bound?.removeEventListener?.('emptied', changedSource);
    bound?.removeEventListener?.('loadstart', changedSource);
    for (const event of playbackEvents) bound?.removeEventListener?.(event, sample);
    bound = null; callback = null; previousFrame = null;
  }
  function bind(player, nextGeneration) {
    if (player === bound && generation === nextGeneration) return;
    unbind(); bound = player; generation = nextGeneration; id++;
    if (!player) return;
    player.addEventListener?.('emptied', changedSource);
    player.addEventListener?.('loadstart', changedSource);
    for (const event of playbackEvents) player.addEventListener?.(event, sample);
    const owner = token, playerId = id, ownerGeneration = nextGeneration;
    const onFrame = (now, meta) => {
      if (!enabled || token !== owner || bound !== player) return;
      try { if (getPlayer() !== player || getGeneration() !== ownerGeneration) return; } catch { return; }
      const at = timeOrigin + (meta?.expectedDisplayTime ?? now), media = meta?.mediaTime;
      const presented = Number.isSafeInteger(meta?.presentedFrames) && meta.presentedFrames > 0 ? meta.presentedFrames : null;
      if (Number.isFinite(at) && Number.isFinite(media) && media >= 0) {
        if (previousFrame && presented !== null && previousFrame.presented !== null && presented > previousFrame.presented + 1) {
          append('losses', losses, [previousFrame.at, round(at), presented - previousFrame.presented - 1], maximumStates);
        }
        append('frames', frames, [round(at), round(media, 4), playerId, presented], maximumFrames);
        previousFrame = { at: round(at), presented };
      }
      callback = player.requestVideoFrameCallback(onFrame);
    };
    if (typeof player.requestVideoFrameCallback === 'function') callback = player.requestVideoFrameCallback(onFrame);
  }
  function sample() {
    if (!enabled) return;
    let player = null, nextGeneration = null, presentation = { mode: 'unknown', heldMediaTime: null };
    try { player = getPlayer(); nextGeneration = getGeneration(); presentation = getPresentation(); } catch {}
    bind(player, nextGeneration);
    const mode = player ? presentation.mode : 'hidden';
    const held = mode === 'held' && Number.isFinite(presentation.heldMediaTime) ? round(presentation.heldMediaTime, 4) : null;
    const state = [player ? id : null, ['video', 'hidden', 'held'].includes(mode) ? mode : 'unknown', held];
    const key = JSON.stringify(state);
    if (key !== lastState) { append('states', states, [round(clock()), ...state], maximumStates); lastState = key; }
    const flag = name => typeof player?.[name] === 'boolean' ? player[name] : null;
    const transport = [player ? id : null, flag('paused'), flag('seeking'), flag('ended')];
    const transportKey = JSON.stringify(transport);
    if (transportKey !== lastPlayback) {
      append('playback', playback, [round(clock()), ...transport], maximumStates); lastPlayback = transportKey;
    }
  }
  function observe() {
    if (!enabled) return;
    const at = round(clock());
    if (lastTick === null || at - lastTick > maximumHeartbeatGapMs) append('spans', spans, [at, at], maximumStates);
    else spans.at(-1)[1] = at;
    lastTick = at; sample();
  }
  function tick(owner) {
    if (!enabled || owner !== observationGeneration) return;
    observe();
    animation = window.requestAnimationFrame(() => tick(owner));
  }
  return {
    sample,
    setEnabled(on) {
      on = on === true;
      if (on === enabled) return;
      enabled = on; lastTick = null; lastState = null; lastPlayback = null;
      const owner = ++observationGeneration;
      if (on) {
        sample(); animation = window.requestAnimationFrame(() => tick(owner));
        // Staged renderer animation callbacks can be absent before cover.
        // This samples metadata, never invents frames or bridges suspension.
        // The controller still requires its own uninterrupted animation clock.
        if (heartbeatTimer) timer = heartbeatTimer.setInterval(() => {
          if (enabled && owner === observationGeneration) observe();
        }, 50);
      } else {
        if (animation !== null) window.cancelAnimationFrame(animation);
        if (timer !== null) heartbeatTimer.clearInterval(timer);
        animation = timer = null; unbind();
      }
    },
    clear() {
      frames.length = states.length = spans.length = losses.length = playback.length = 0;
      for (const key of Object.keys(dropped)) dropped[key] = 0;
      lastTick = null; lastState = null; lastPlayback = null; unbind(); if (enabled) sample();
    },
    snapshot() {
      sample();
      return { frames: frames.map(x => [...x]), states: states.map(x => [...x]), spans: spans.map(x => [...x]),
        losses: losses.map(x => [...x]), playback: playback.map(x => [...x]), dropped: { ...dropped }, maximumHeartbeatGapMs };
    }
  };
}
