import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
/** Chrome derives an unpacked extension's ID from the manifest `key` (first 32 hex digits of SHA-256 of the DER public key, mapped 0-f to a-p).
 * The website registers that origin, the device-link policy is keyed by it and a future .crx signed with the owner's
 * private signing key carries it, so a manifest key that derives to anything else silently breaks linking for every install. */
export const FIXED_EXTENSION_ID='fhnhobmieopplfhfojccjnomhekbbpfo';
export function extensionIdFromKey(key){const digest=createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32);return [...digest].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');}
test('the manifest key derives to the fixed extension ID the website and device-link policy are registered for',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.equal(typeof manifest.key,'string');
 assert.equal(extensionIdFromKey(manifest.key),FIXED_EXTENSION_ID,'manifest.json key must be the public half of the owner\'s private signing key (openssl rsa -in KEY.pem -pubout -outform DER | base64 -w0)');
});
