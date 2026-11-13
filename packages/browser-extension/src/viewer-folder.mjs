import {isSystemFileName,isSystemFolderName} from './system-files.mjs';

export async function readEditDirectory(handle,{signal,maxFiles=1001,maxBytes=2147483648}={}) {
 if(handle?.kind!=='directory')throw Error('Select an edit folder');const files=[];let bytes=0;
 const check=()=>{if(signal?.aborted)throw signal.reason??Error('Folder read cancelled');};
 async function visit(dir,prefix,depth){check();if(depth>8)throw Error('Folder nesting limit');for await(const [name,entry] of dir.entries()){
  check();if(!name||name==='.'||name==='..'||/[/\0]/.test(name))throw Error('Unsafe edit path');
  // System files (.DS_Store, ._*, Thumbs.db) and names no packet can bind (a macOS name may contain \) are skipped, not fatal.
  if(entry.kind==='directory'?isSystemFolderName(name):isSystemFileName(name))continue;if(name.includes('\\'))continue;const path=prefix+name;
  if(entry.kind==='directory')await visit(entry,path+'/',depth+1);
  else if(entry.kind==='file'){if(files.length>=maxFiles)throw Error('Edit file limit');const file=await entry.getFile();check();bytes+=file.size;if(file.size>536870912||bytes>maxBytes)throw Error('Edit byte limit');Object.defineProperty(file,'webkitRelativePath',{value:path});files.push(file);}else throw Error('Unsupported edit entry');
 }}await visit(handle,'',0);return files;
}
