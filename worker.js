import {planMaterials} from './show-plan.mjs';
import {decodeGif} from './gif.mjs';
self.onmessage=async({data:{id,materials,count}})=>{
  try{
    const decoded=[],failedIndices=[];
    materials.forEach((material,i)=>{try{if(material.kind==='gif'){const gif=decodeGif(material.buffer,{maxFrames:material.maxFrames||12});decoded.push({kind:'gif',frames:gif.images,durations:gif.durations});}else decoded.push({kind:'static',frames:[material.raster]});}catch{failedIndices.push(i);}});
    if(!decoded.length){self.postMessage({id,error:'画像を解析できませんでした。素材を選び直してください。',failedIndices});return;}
    self.postMessage({id,...planMaterials(decoded,count),failedIndices});
  }
  catch(error){self.postMessage({id,error:error.message||'輪郭を処理できませんでした。'});}
};
