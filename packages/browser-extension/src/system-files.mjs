// Files that Finder, Explorer and cloud/network drives add to folders on their own.
// A viewer never chose them, so folder imports skip them before counting or budgeting.
const SYSTEM_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '.localized', 'icon\r']);
const SYSTEM_FOLDER_NAMES = new Set(['__macosx', '.spotlight-v100', '.trashes', '.fseventsd', '.temporaryitems', '$recycle.bin', 'system volume information']);

export function isSystemFolderName(name) {
  return typeof name === 'string' && SYSTEM_FOLDER_NAMES.has(name.toLowerCase());
}

export function isSystemFileName(name) {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  // AppleDouble resource forks written to exFAT, FAT32 and SMB volumes.
  return SYSTEM_FILE_NAMES.has(lower) || lower.startsWith('._');
}

export function isSystemFilePath(path) {
  if (typeof path !== 'string') return false;
  const parts = path.replaceAll('\\', '/').split('/');
  return isSystemFileName(parts.at(-1)) || parts.slice(0, -1).some(isSystemFolderName);
}

export function withoutSystemFiles(files) {
  return [...files].filter(file => !isSystemFilePath(file?.webkitRelativePath || file?.name));
}
