import { EXECUTING_BUILD } from '../../browser-extension/src/build-info.mjs';
import { sameExecutingBuild } from '../../browser-extension/src/build-identity.mjs';
// Only the admitted service worker can initiate this private completion RPC.
// Content scripts, account tabs, provider pages and mixed builds cannot use it.
export function subscribePrivateSignOut(runtime, cleanup) {
  const listener = (message, sender, respond) => {
    if (message?.kind !== 'protected-signout') return;
    if (sender?.id !== runtime.id || sender.tab || !['background.mjs', 'catalog-fixture-background.mjs'].some(p => sender.url === runtime.getURL(p)) ||
      Object.keys(message).sort().join(',') !== 'build,kind' || !sameExecutingBuild(message.build)) return;
    Promise.resolve().then(cleanup).then(() => respond({ ok: true, build: EXECUTING_BUILD }),
      () => respond({ ok: false, code: 'protected-signout-incomplete', build: EXECUTING_BUILD }));
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}
