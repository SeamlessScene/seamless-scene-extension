const loadedStates = new Set(['loaded', 'ready', 'armed', 'active', 'paused', 'restoring', 'finished', 'failed']);
const nameText = value => typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : '';
const identityKey = value => JSON.stringify([value?.editId, value?.sourceKey, value?.version]);

// Descriptive library metadata never selects an edit or grants playback access.
// Name the exact loaded release and version. The release id already binds the
// source; a library row's sourceKey comes from the packet (territory, plan,
// packet runtime) and never equals the key observed from Prime, so it is not compared.
export function loadedEditMetadata(playback, library) {
  if (!loadedStates.has(playback?.state) || !playback.editId || !playback.version) return {};
  const rows = (library ?? []).filter(row => row.id === playback.editId && String(row.version) === playback.version);
  const names = new Set(rows.map(row => nameText(row.name) || nameText(row.title)));
  // The website's display version ("v4", r30), when the rows agree on one.
  const shown = new Set(rows.map(row => row.displayVersion).filter(validDisplay));
  const display = shown.size === 1 ? { displayVersion: [...shown][0] } : {};
  if (names.size !== 1) return display;
  const [editName] = names;
  return editName ? { editName, ...display } : display;
}

const validDisplay = value => Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;
/** The version a viewer sees: the website's display version when known, else the packet's manifest version. */
export function shownVersion(value) {
  if (validDisplay(value?.displayVersion)) return String(value.displayVersion);
  return typeof value?.version === 'string' && /^\d{1,64}$/.test(value.version) ? value.version : '';
}

export function loadedEditLabel(playback) {
  if (!loadedStates.has(playback?.state) || !playback.editId) return '';
  const name = nameText(playback.editName);
  const shown = shownVersion(playback), version = shown ? ` · v${shown}` : '';
  return name ? `${name}${version}` : '';
}

// The controller's read handler stays independent of worker requests. Only the
// display reader asks for names, avoiding a snapshot -> controller -> snapshot loop.
export function createLoadedEditDisplayReader({ read, request, show = () => {}, now = () => performance.now() }) {
  let cached = null;
  return async () => {
    const current = await read(), key = identityKey(current);
    let snapshot = null;
    if (!current.canStop || !cached || cached.key !== key || now() - cached.at >= 3000) {
      snapshot = await request().catch(() => null);
      cached = { key, at: now(), playback: snapshot?.playback, matches: Array.isArray(snapshot?.matches) ? snapshot.matches : [] };
    }
    const described = cached.playback;
    const same = identityKey(described) === key;
    const editName = same ? nameText(described?.editName) : '';
    const displayVersion = same && validDisplay(described?.displayVersion) ? described.displayVersion : null;
    const { editName: ignoredName, displayVersion: ignoredDisplay, ...currentFields } = current;
    // The chooser's matching downloaded edits come from the service's last answer.
    const result = { ...currentFields, ...(editName ? { editName } : {}), ...(displayVersion ? { displayVersion } : {}), ...(!current.canStop ? { load: snapshot?.load } : {}), matches: cached.matches };
    show(loadedEditLabel(result));
    return result;
  };
}
