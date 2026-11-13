import { supportsAssetDuration, supportsBoundedAssetDimensions } from "./asset-duration-policy.mjs";

import { inspectMp4Format } from './mp4-format-probe.mjs';
import { assertActive, boundedOperation } from './operation-context.mjs';
import { sha256Hex, MAX_LOCAL_ASSET_BYTES } from './local-file-hash.mjs';
export { sha256Hex } from './local-file-hash.mjs';
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ALLOWED_RESOLUTIONS = new Set(["1280x720", "1920x1080"]);

export class LocalAssetValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "LocalAssetValidationError";
    this.code = code;
  }
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeHex(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function waitForMediaEvent(media, eventNames, { timeoutMs, signal, condition = () => true, pollCondition = null }) {
  return new Promise((resolve, reject) => {
    let polling = null, settled = false;
    const names = Array.isArray(eventNames) ? eventNames : [eventNames];
    const timeout = setTimeout(() => finish(new LocalAssetValidationError("decode-timeout")), timeoutMs);
    const listeners = names.map((name) => [name, () => {
      if (condition()) finish();
    }]);
    const onError = () => finish(new LocalAssetValidationError("decode-failed"));
    const onAbort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (polling !== null) clearInterval(polling);
      for (const [name, listener] of listeners) media.removeEventListener(name, listener);
      media.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    for (const [name, listener] of listeners) media.addEventListener(name, listener);
    media.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    // timeupdate may arrive hundreds of milliseconds after readiness. This
    // optional, owned fast path is used only for the initial local decode and
    // requires stronger evidence than the unchanged event fallback.
    if (pollCondition) polling = setInterval(() => { if (!settled && pollCondition()) finish(); }, 10);
    if (signal?.aborted) onAbort();
  });
}

function localAudioPresence(video) {
  const tracks = video.audioTracks;
  return tracks && typeof tracks.length === 'number'
    ? tracks.length > 0
    : typeof video.webkitAudioDecodedByteCount === 'number'
      ? video.webkitAudioDecodedByteCount > 0
      : video.mozHasAudio === true ? true : null;
}

export function validateAuthoredAssetProfile(expected, { profileClass = "mvp" } = {}) {
  const errors = [];
  const width = expected?.width;
  const height = expected?.height;
  const resolution = `${width}x${height}`;
  if (!SHA256_HEX.test(normalizeHex(expected?.sha256))) errors.push("invalid-expected-sha256");
  if (!supportsAssetDuration(expected?.durationMs, profileClass)) {
    errors.push("invalid-expected-duration");
  }
  if (expected?.container !== "mp4") errors.push("unsupported-container");
  if (expected?.videoCodec !== "h264") errors.push("unsupported-video-codec");
  if (expected?.audioCodec !== "aac") errors.push("unsupported-audio-codec");
  const dimensionsAllowed = profileClass === "local-user" || profileClass === "catalog-v2"
    ? supportsBoundedAssetDimensions(width, height)
    : ALLOWED_RESOLUTIONS.has(resolution) && width * 9 === height * 16;
  if (!dimensionsAllowed) errors.push("unsupported-dimensions");
  if (expected?.dynamicRange !== "sdr") errors.push("unsupported-dynamic-range");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateMeasuredAsset(measured, expected, actualSha256, { profileClass = "mvp" } = {}) {
  const authored = validateAuthoredAssetProfile(expected, { profileClass });
  const errors = [...authored.errors];
  const toleranceMs = finiteNumber(expected?.durationToleranceMs) ? expected.durationToleranceMs : 100;

  if (measured?.mediaType !== "video/mp4") errors.push("not-mp4");
  if (normalizeHex(actualSha256) !== normalizeHex(expected?.sha256)) errors.push("sha256-mismatch");
  if (!finiteNumber(measured?.durationMs) || Math.abs(measured.durationMs - expected?.durationMs) > toleranceMs) {
    errors.push("duration-mismatch");
  }
  if (!supportsAssetDuration(measured?.durationMs, profileClass)) errors.push("measured-duration-out-of-range");
  if (measured?.width !== expected?.width || measured?.height !== expected?.height) errors.push("dimensions-mismatch");
  if (measured?.initialSampleDecoded !== true) errors.push("initial-decode-failed");
  if (measured?.audioPresent !== true) errors.push("audio-track-missing");
  for (const [key, code] of [['container', 'container'], ['videoCodec', 'video-codec'], ['audioCodec', 'audio-codec'], ['dynamicRange', 'dynamic-range']]) {
    if (measured?.[key] !== expected?.[key]) errors.push(`measured-${code}-mismatch`);
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    metadata: Object.freeze({
      sha256: normalizeHex(actualSha256),
      durationMs: finiteNumber(measured?.durationMs) ? Math.round(measured.durationMs) : null,
      width: finiteNumber(measured?.width) ? measured.width : null,
      height: finiteNumber(measured?.height) ? measured.height : null,
      container: measured?.container ?? null,
      videoCodec: measured?.videoCodec ?? null,
      audioCodec: measured?.audioCodec ?? null,
      dynamicRange: measured?.dynamicRange ?? null,
      formatProvenance: measured?.formatProvenance ?? null,
      colorEvidence: measured?.colorEvidence ?? null
    })
  });
}

export async function inspectLocalMedia(file, {
  document = globalThis.document,
  urlApi = globalThis.URL,
  signal,
  timeoutMs = 5_000
} = {}) {
  if (!document?.createElement || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
    throw new LocalAssetValidationError("media-inspection-unavailable");
  }

  assertActive(signal);
  const video = document.createElement("video");
  const objectUrl = urlApi.createObjectURL(file);
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;

  try {
    video.src = objectUrl;
    video.load();
    if (video.readyState < 1) await waitForMediaEvent(video, "loadedmetadata", { timeoutMs, signal });
    if (video.readyState < 2) await waitForMediaEvent(video, ["loadeddata", "canplay"], { timeoutMs, signal });

    await boundedOperation(() => video.play(), { signal, timeoutMs, label: 'initial-decode' }).catch(() => {
      throw new LocalAssetValidationError("initial-decode-failed");
    });
    if (video.currentTime < 0.02) {
      await waitForMediaEvent(video, ["timeupdate", "ended"], {
        timeoutMs,
        signal,
        condition: () => video.currentTime >= 0.02 || video.ended,
        pollCondition: () => video.readyState >= 2 && (video.currentTime >= 0.02 || video.ended) && localAudioPresence(video) === true
      });
    }
    video.pause();

    const audioPresent = localAudioPresence(video);

    return Object.freeze({
      mediaType: 'video/mp4',
      durationMs: video.duration * 1_000,
      width: video.videoWidth,
      height: video.videoHeight,
      initialSampleDecoded: true,
      audioPresent
    });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    urlApi.revokeObjectURL(objectUrl);
  }
}

export async function validateLocalAsset(file, expected, {
  hash = sha256Hex,
  inspect = inspectLocalMedia,
  inspectFormat = inspectMp4Format,
  signal,
  profileClass = "mvp"
} = {}) {
  const authored = validateAuthoredAssetProfile(expected, { profileClass });
  if (!authored.ok) return Object.freeze({ ok: false, errors: authored.errors, metadata: null });

  assertActive(signal);
  if (!Number.isSafeInteger(file?.size) || file.size < 0 || file.size > MAX_LOCAL_ASSET_BYTES) return Object.freeze({ ok: false, errors: ['local-asset-byte-budget-exceeded'], metadata: null });
  const actualSha256 = await hash(file, { signal, maxBytes: MAX_LOCAL_ASSET_BYTES, timeoutMs: 30000 });
  assertActive(signal);
  if (actualSha256 !== normalizeHex(expected.sha256)) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(["sha256-mismatch"]),
      metadata: null
    });
  }

  const format = await boundedOperation(() => inspectFormat(file, { signal }), { signal, timeoutMs: 5000, label: 'mp4-format' });
  assertActive(signal);
  const measured = { ...await inspect(file, { signal }), ...format };
  assertActive(signal);
  return validateMeasuredAsset(measured, expected, actualSha256, { profileClass });
}
