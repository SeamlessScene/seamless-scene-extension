// Pure projection of already admitted scheduler actions; never grants playback.
export function editedTimeline(durationMs,actions) {
  if(!Number.isFinite(durationMs)||durationMs<=0||!Array.isArray(actions)||actions.length>1000)throw Error('viewer-timeline-unavailable');
  let source=0,edited=0;const segments=[],ids=new Set();
  const add=(type,id,start,end,length)=>{segments.push({type,id,sourceStartMs:start,sourceEndMs:end,startMs:edited,endMs:edited+length});edited+=length;};
  for(const a of actions){
    const {id,type,triggerMs,resumeMs}=a;
    if(typeof id!=='string'||ids.has(id)||!['INSERT','REPLACE','SKIP','MUTE'].includes(type)||!Number.isFinite(triggerMs)||!Number.isFinite(resumeMs)||triggerMs<source||resumeMs<triggerMs||resumeMs>durationMs)throw Error('viewer-timeline-invalid');
    ids.add(id);if(triggerMs>source)add('SOURCE',null,source,triggerMs,triggerMs-source);
    let length=resumeMs-triggerMs;
    if(['INSERT','REPLACE'].includes(type)){
      if(!Number.isFinite(a.expectedDurationMs)||a.expectedDurationMs<=0)throw Error('viewer-timeline-duration-required');
      if(type==='INSERT'&&resumeMs!==triggerMs)throw Error('viewer-timeline-invalid-insert');length=a.expectedDurationMs;
    }else if(type==='SKIP')length=0;
    add(type,id,triggerMs,resumeMs,length);source=resumeMs;
  }
  if(source<durationMs)add('SOURCE',null,source,durationMs,durationMs-source);
  return Object.freeze({durationMs:edited,segments:Object.freeze(segments.map(Object.freeze))});
}
export function editedPosition(timeline,{sourceTimeMs,actionId=null,localTimeMs=null}) {
  if(!timeline||!Number.isFinite(sourceTimeMs))return null;
  if(actionId){
    const s=timeline.segments.find(s=>s.id===actionId);
    if(!s)return null;
    if(['INSERT','REPLACE'].includes(s.type))return Number.isFinite(localTimeMs)?s.startMs+Math.min(s.endMs-s.startMs,Math.max(0,localTimeMs)):null;
  }
  // At INSERT anchors prefer the following source segment when no action is active.
  const s=timeline.segments.findLast(s=>s.type!=='INSERT'&&sourceTimeMs>=s.sourceStartMs&&sourceTimeMs<=s.sourceEndMs);
  if(!s)return sourceTimeMs>=timeline.segments.at(-1)?.sourceEndMs?timeline.durationMs:null;
  if(s.type==='REPLACE')return null; // Cannot infer decoded replacement progress from the source clock.
  if(s.type==='SKIP')return s.startMs;
  return s.startMs+Math.max(0,Math.min(s.endMs-s.startMs,sourceTimeMs-s.sourceStartMs));
}
