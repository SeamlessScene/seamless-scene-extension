# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository (Security → Advisories). Do not open a public issue for a security problem.

Only the latest published version is supported; fixes ship as a new version through the Chrome Web Store.

Useful reports say which build (extension version, shown in the popup and settings), what an attacker controls (a web page, a crafted edit packet, a local file) and what they gain. We aim to acknowledge within a week.

Areas we care most about:

- anything that lets a web page, including a streaming page, read local clip files, edit packets or device-link tokens;
- forging or replaying messages between the page, the content script, the service worker and the private renderer frame;
- bypassing signature, licence or source-identity checks on edit packets;
- the website bridge (`packages/browser-extension/src/viewer-web-bridge.mjs`), which answers only the Seamless Scene website's origins.

Out of scope: the streaming services themselves, and DRM — the extension never captures, decrypts or proxies protected video.
