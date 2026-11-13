import { spawn } from 'node:child_process';

/** No shell, bounded output, deadline and cancellation for each child. */
export async function runBounded(command,args,{timeoutMs=60_000,maxOutputBytes=1_048_576,signal}={}){
  if(signal?.aborted)throw new Error('Job cancelled');
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let bytes=0,stdout='',stderr='',failure;
    const stop=message=>{if(!failure){failure=new Error(message);child.kill('SIGKILL');}};
    const timer=setTimeout(()=>stop('Media process exceeded its deadline'),timeoutMs);
    const abort=()=>stop('Job cancelled');signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxOutputBytes)stop('Media process exceeded its output limit');else stdout+=chunk.toString('utf8');});
    child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxOutputBytes)stop('Media process exceeded its output limit');else stderr+=chunk.toString('utf8');});
    child.on('error',error=>{failure??=error;});
    child.on('close',code=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(failure)reject(failure);
      else if(code!==0)reject(new Error(`Media validation failed (exit ${code})`));
      else resolve({stdout,stderr});
    });
  });
}
