// Rewrites an MP4's movie header (mvhd) duration, so a test can present one synthetic clip as
// any length to code that reads the header (the edit pack normaliser). The media is unchanged.
export function withMvhdDurationMs(bytes, durationMs) {
  const out = new Uint8Array(bytes), v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 4; i + 4 <= out.length; i++) {
    if (out[i] !== 0x6d || out[i + 1] !== 0x76 || out[i + 2] !== 0x68 || out[i + 3] !== 0x64) continue; // 'mvhd'
    const s = i + 4, version = out[s];
    if (version === 1) { const ts = v.getUint32(s + 20), d = Math.round(durationMs * ts / 1000); v.setUint32(s + 24, Math.floor(d / 2 ** 32)); v.setUint32(s + 28, d >>> 0); }
    else { const ts = v.getUint32(s + 12); v.setUint32(s + 16, Math.round(durationMs * ts / 1000)); }
    return out;
  }
  throw Error('no mvhd box');
}
