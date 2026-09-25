import {planShow} from './sampler.mjs';

// Align neighboring shapes by spatial order while retaining each drone's ID.
function key(p){
  const x=Math.max(0,Math.min(1023,Math.floor((p.x+.5)*1023)));
  const y=Math.max(0,Math.min(1023,Math.floor((p.y+.5)*1023)));
  let result=0;
  for(let bit=0;bit<10;bit++){result|=((x>>bit)&1)<<(2*bit);result|=((y>>bit)&1)<<(2*bit+1);}
  return result;
}
export function matchFrames(frames){
  if(!frames.length)return [];
  const result=[frames[0].slice().sort((a,b)=>key(a)-key(b))];
  for(let f=1;f<frames.length;f++){
    const previous=result[f-1],current=frames[f].slice().sort((a,b)=>key(a)-key(b));
    const order=previous.map((p,i)=>({i,key:key(p)})).sort((a,b)=>a.key-b.key);
    const aligned=new Array(previous.length);
    for(let i=0;i<order.length;i++)aligned[order[i].i]=current[i];
    result.push(aligned);
  }
  return result;
}
function buildFrames(inputs,requestedCount,representatives,blankFrames){
  if(requestedCount&&![1000,1500,2000].includes(requestedCount))throw new Error('Invalid drone count');
  const raster=input=>new Uint8ClampedArray(input.pixels);
  const preliminary=new Map();
  if(!requestedCount)for(const i of representatives){const input=inputs[i];preliminary.set(i,planShow(raster(input),input.width,input.height));}
  const count=requestedCount||Math.max(...[...preliminary.values()].map(result=>result.count));
  if(!count)throw new Error('輪郭線が見つかりませんでした。別の画像や範囲をお試しください。');
  const frames=inputs.map((input,i)=>{
    const preliminaryFrame=preliminary.get(i);
    let points=preliminaryFrame?.count===count?preliminaryFrame.points:planShow(raster(input),input.width,input.height,count).points;
    if(!points.length&&blankFrames.has(i))points=Array.from({length:count},()=>({x:2,y:2,r:0,g:0,b:0}));
    return points;
  });
  if(frames.some(points=>points.length<count))throw new Error('いずれかの画像で指定機数に必要な輪郭が見つかりませんでした。画像や範囲を変更してください。');
  return {count,frames:matchFrames(frames)};
}
export function planFrames(inputs,requestedCount=0,gif=false){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>(gif?12:3))throw new Error('Invalid image count');
  return buildFrames(inputs,requestedCount,inputs.map((_,i)=>i),new Set());
}
export function planMaterials(materials,requestedCount=0){
  if(!Array.isArray(materials)||materials.length<1||materials.length>3)throw new Error('Invalid material count');
  const inputs=[],descriptors=[],representatives=[],blankFrames=new Set();
  for(const material of materials){
    if(!['static','gif'].includes(material.kind)||!material.frames?.length||material.kind==='static'&&material.frames.length!==1)throw new Error('Invalid material');
    const start=inputs.length;inputs.push(...material.frames);const end=inputs.length-1;
    descriptors.push({kind:material.kind,start,end,durations:material.kind==='gif'?material.durations:[]});
    if(material.kind==='gif'){for(const i of new Set([start,Math.floor((start+end)/2),end]))representatives.push(i);for(let i=start;i<=end;i++)blankFrames.add(i);}
    else representatives.push(start);
  }
  if(inputs.length>36)throw new Error('GIFのフレーム数が多すぎます。');
  return {...buildFrames(inputs,requestedCount,representatives,blankFrames),materials:descriptors};
}
