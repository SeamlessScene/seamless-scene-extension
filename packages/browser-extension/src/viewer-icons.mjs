// Fixed vector artwork; no remote image or page-provided markup.
// The on-player badge: neutral grey when off, a green outline while an edit is on
// and waiting, solid green while a scene plays, and a red dot only for a problem.
const BADGES = Object.freeze({
  off: { fill: '#3a4641', ring: null, dot: '#6d7a74' },
  ready: { fill: '#1f5a40', ring: '#8fd3b0', dot: '#8fd3b0' },
  on: { fill: '#2f9e6a', ring: null, dot: '#ffffff' },
  bad: { fill: '#3a4641', ring: null, dot: '#e0675f' }
});
export function stateIcon(tone = 'off', paused = false) {
  const c = BADGES[tone] ?? BADGES.off;
  const ink = tone === 'on' ? '#06140d' : '#0b0f0d';
  const mark = tone === 'bad' ? `<path d="M52 44v7m0 4v.5" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`
    : paused ? `<path d="M48 45h2.6v10H48zm5.4 0H56v10h-2.6z" fill="${ink}"/>`
    : tone === 'on' ? `<path d="m49 45 8 5-8 5Z" fill="${ink}"/>` : '';
  const ring = c.ring ? `<rect x="3" y="3" width="58" height="58" rx="14" fill="none" stroke="${c.ring}" stroke-width="3"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><rect x="1" y="1" width="62" height="62" rx="16" fill="${c.fill}"/>${ring}<path d="M27 18H16a6 6 0 0 0 0 12h6a6 6 0 0 1 0 12H11m42-24H42a6 6 0 0 0 0 12h6a6 6 0 0 1 0 12H37" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="52" cy="50" r="10" fill="${c.dot}" stroke="#0b0f0d" stroke-width="2.5"/>${mark}</svg>`;
}
/** Toolbar tone: "on" only while an edit is on (armed or playing); everything else is off. */
export function toolbarTone(s) { return ['armed', 'active', 'paused'].includes(s?.state) ? 'on' : 'off'; }
export const iconPaths = tone => Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/ss-${tone}-${size}.png`]));
/** The toolbar keeps the brand icon; an edit that is on shows a short "ON" badge. */
export function toolbarBadge(tone) { return tone === 'on' ? { text: 'ON', color: '#167347' } : { text: '', color: '#64716b' }; }
