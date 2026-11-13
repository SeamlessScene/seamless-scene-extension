import { createReadStream } from 'node:fs';
import { lstat,realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_CLIP_BYTES=250_000_000;
export const MAX_RELEASE_BYTES=2_000_000_000;
export function assertRelativeMediaPath(value){
  if(typeof value!=='string'||value.length>256||!(/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.mp4$/).test(value))throw new Error('Unsafe media filename');
  if(value.split('/').some(part=>part==='.'||part==='..'||part.endsWith('.')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('Non-portable media filename');
  return value;
}
export async function resolveMediaFile(root,relative){
  assertRelativeMediaPath(relative);
  const canonicalRoot=await realpath(root);
  let current=canonicalRoot;
  for(const part of relative.split('/')){
    current=path.join(current,part);
    if((await lstat(current)).isSymbolicLink())throw new Error('Media paths cannot contain symbolic links');
  }
  const canonicalFile=await realpath(current);
  const difference=path.relative(canonicalRoot,canonicalFile);
  if(difference.startsWith('..')||path.isAbsolute(difference))throw new Error('Media file escapes the job directory');
  const stat=await lstat(canonicalFile);
  if(!stat.isFile()||stat.size<1||stat.size>MAX_CLIP_BYTES)throw new Error('Clip size is outside the resource limit');
  return {path:canonicalFile,size:stat.size};
}
export async function hashFile(filename,maxBytes=MAX_CLIP_BYTES){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(filename)){
    bytes+=chunk.length;if(bytes>maxBytes)throw new Error('File exceeds the resource limit');hash.update(chunk);
  }
  return {sha256:hash.digest('hex'),bytes};
}
