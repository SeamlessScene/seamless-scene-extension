// This proof is delivered only into the controller's exact child Window at an
// exact origin, and returned via the browser-authenticated runtime Port. It is
// never placed in the DOM, iframe URL, a parent-window broadcast or telemetry.
export const PRIVATE_PARENT_BINDING = 'scene-private-parent-binding-v1';
export function bindingMessage(value, type) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === 2 && fields.type?.value === type &&
    typeof fields.challenge?.value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(fields.challenge.value);
}
export function assertOwnedPrivateFrame(document, frame) {
  if (!document.defaultView || document.defaultView !== document.defaultView.top ||
      !frame?.isConnected || frame.ownerDocument !== document || !frame.contentWindow) throw Error('private-frame-owner-lost');
}
export function sendParentBinding({ document, frame, targetOrigin, challenge }) {
  assertOwnedPrivateFrame(document, frame);
  if (!bindingMessage({ type: PRIVATE_PARENT_BINDING, challenge }, PRIVATE_PARENT_BINDING) ||
      typeof targetOrigin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}$/.test(targetOrigin)) throw Error('private-frame-binding-invalid');
  frame.contentWindow.postMessage({ type: PRIVATE_PARENT_BINDING, challenge }, targetOrigin);
}
export function receivedParentBinding(event, window, allowedParentOrigins) {
  // Chromium may redact MessageEvent.source for privileged callers. The secret
  // proof still has to return through the expected renderer's own runtime Port.
  if (event.isTrusted !== true || window.parent === window || window.parent !== window.top ||
      window.location.ancestorOrigins?.length !== 1 || !allowedParentOrigins.includes(window.location.ancestorOrigins[0]) ||
      event.origin !== window.location.ancestorOrigins[0] || (event.source !== null && event.source !== window.parent) ||
      !bindingMessage(event.data, PRIVATE_PARENT_BINDING)) return null;
  return event.data.challenge;
}
