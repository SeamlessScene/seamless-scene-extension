import { mkdir, open, rm, readdir, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';

export function directory(path, failWrite = false) {
  return {
    async getDirectoryHandle(name, { create = false } = {}) { const child = join(path, name); if (create) await mkdir(child, { recursive: true }); else { try { await stat(child); } catch { throw new DOMException('missing', 'NotFoundError'); } } return directory(child, failWrite); },
    async *entries() { for (const name of await readdir(path)) yield [name, null]; },
    async removeEntry(name) { await rm(join(path, name), { recursive: true, force: true }); },
    async getFileHandle(name, { create = false } = {}) {
      const file = join(path, name);
      if (!create) { try { await stat(file); } catch { throw new DOMException('missing', 'NotFoundError'); } }
      return { async getFile() { return openAsBlob(file); }, async createWritable() {
        const handle = await open(file, 'w'); let ended = false;
        return { async write(bytes) { if (failWrite) throw Error('disk-full'); await handle.write(bytes); }, async close() { if (!ended) { ended = true; await handle.close(); } }, async abort() { if (!ended) { ended = true; await handle.close(); } } };
      } };
    },
  };
}
