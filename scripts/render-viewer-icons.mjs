// Rebuild the fixed local SVG monogram as Chrome-compatible PNGs.
// SHARP_MODULE points to an already-installed sharp module; no network/downloads.
import {fileURLToPath,pathToFileURL} from 'node:url';import {mkdir} from 'node:fs/promises';
import {stateIcon} from '../packages/browser-extension/src/viewer-icons.mjs';
if(!process.env.SHARP_MODULE)throw Error('SHARP_MODULE required');const {default:sharp}=await import(pathToFileURL(process.env.SHARP_MODULE));
const dir=new URL('../packages/browser-extension/icons/',import.meta.url);await mkdir(dir,{recursive:true});
for(const tone of ['active','armed','inactive','neutral'])for(const size of [16,32,48,128])await sharp(Buffer.from(stateIcon(tone))).resize(size,size).png().toFile(fileURLToPath(new URL(`ss-${tone}-${size}.png`,dir)));
