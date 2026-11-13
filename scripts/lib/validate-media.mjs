import { validateAuthoredAssetProfile } from '../../packages/browser-extension/src/local-asset-validator.mjs';
import { hashFile,resolveMediaFile } from './files.mjs';
import { runBounded } from './process.mjs';

/** Legacy signed catalog limits remain enforced until the coordinated client
 * profile expansion is implemented. Private local-user trust is never chosen
 * from uploaded metadata, dimensions, or a creator's requested profile. */
export async function validateMedia(root,binding,{ffprobe='ffprobe',ffmpeg='ffmpeg',signal,timeoutMs=120_000,profileClass='mvp'}={}){
  if(!['mvp','catalog-v2'].includes(profileClass))throw new Error('Unsupported signed media profile');
  if(!Number.isSafeInteger(binding.expected_duration_ms)||!Number.isSafeInteger(binding.width)||!Number.isSafeInteger(binding.height))throw new Error('Manifest media properties are required');
  const file=await resolveMediaFile(root,binding.relative_path);
  const firstHash=await hashFile(file.path);
  if(binding.bytes!==undefined&&(!Number.isSafeInteger(binding.bytes)||binding.bytes!==firstHash.bytes))throw new Error('Actual clip size differs from the frozen upload');
  if(firstHash.sha256!==binding.sha256)throw new Error('Clip hash differs from the submitted binding');
  const probe=await runBounded(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file.path],{timeoutMs:Math.min(timeoutMs,30_000),signal});
  let data;try{data=JSON.parse(probe.stdout);}catch{throw new Error('Invalid probe result');}
  const videos=data.streams?.filter(stream=>stream.codec_type==='video')??[];
  const audios=data.streams?.filter(stream=>stream.codec_type==='audio')??[];
  if(videos.length!==1||audios.length!==1||data.streams.length!==2)throw new Error('Exactly one video and one audio stream are required');
  const video=videos[0],audio=audios[0];
  if(video.codec_name!=='h264'||audio.codec_name!=='aac'||video.pix_fmt!=='yuv420p'||['smpte2084','arib-std-b67'].includes(video.color_transfer))throw new Error('Unsupported codec or dynamic range');
  if(!data.format?.format_name?.split(',').includes('mp4')||!['isom','iso2','iso4','iso5','iso6','mp41','mp42','avc1'].includes(data.format.tags?.major_brand?.trim()))throw new Error('The actual container must be a supported MP4 brand');
  const durationMs=Math.round(Number(video.duration??data.format.duration)*1000);
  const properties={sha256:firstHash.sha256,durationMs,width:video.width,height:video.height,container:'mp4',videoCodec:'h264',audioCodec:'aac',dynamicRange:'sdr'};
  const profile=validateAuthoredAssetProfile(properties,{profileClass});
  if(!profile.ok)throw new Error(`Clip does not fit the supported signed profile: ${profile.errors.join(', ')}`);
  if(Math.abs(durationMs-binding.expected_duration_ms)>100||video.width!==binding.width||video.height!==binding.height)throw new Error('Measured clip properties differ from the submitted manifest');
  // Full decode is validation only. No media is generated or transcoded.
  await runBounded(ffmpeg,['-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',file.path,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeoutMs,signal});
  const finalHash=await hashFile(file.path);
  if(finalHash.sha256!==firstHash.sha256||finalHash.bytes!==firstHash.bytes)throw new Error('Clip changed during validation');
  return {...properties,bytes:finalHash.bytes,relative_path:binding.relative_path,fullyDecoded:true};
}
