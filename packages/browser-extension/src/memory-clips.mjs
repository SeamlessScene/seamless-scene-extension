// Copies checked clips into memory-backed Blobs before playback URLs are made,
// so a cloud-synced, network or removable file that is evicted, re-synced or
// unplugged mid-edit cannot fail a cut. A File changed after selection fails
// to read here, before arming, rather than during a scene. Large clips stay
// file-backed within a per-clip and total budget.
export const MEMORY_CLIP_LIMIT_BYTES = 256 * 1024 * 1024;
export const MEMORY_CLIPS_TOTAL_BYTES = 512 * 1024 * 1024;

export async function memoryBackedClips(files, { signal, perClip = MEMORY_CLIP_LIMIT_BYTES, total = MEMORY_CLIPS_TOTAL_BYTES } = {}) {
  const copies = new Map(files);
  let used = 0;
  // Smallest first, so the budget covers as many clips as possible.
  for (const [key, file] of [...files].sort((a, b) => a[1].size - b[1].size)) {
    signal?.throwIfAborted();
    if (!(file?.size > 0) || file.size > perClip || used + file.size > total) continue;
    const bytes = await file.arrayBuffer();
    signal?.throwIfAborted();
    if (bytes.byteLength !== file.size) throw Error('clip-changed-after-check');
    copies.set(key, new Blob([bytes], { type: file.type || 'video/mp4' }));
    used += file.size;
  }
  return copies;
}
