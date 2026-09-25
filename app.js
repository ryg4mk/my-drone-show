import {clamp,rectFromPoints,moveRect,resizeRect,pixelBounds} from './rectangle.mjs';
import {createRenderer} from './renderer.mjs';
const $=id=>document.getElementById(id),stage=$('stage'),canvas=$('show'),video=$('camera');
const editor=$('editor'),editorCtx=editor.getContext('2d'),editorStage=$('editorStage');
const images=[null,null,null],FIXED={dotSize:1.25,moveMs:5000,holdMs:10000,departureMs:3000};
let renderer=createRenderer(canvas),activeImage=0,selectionDrag=null,frames=[],materials=[],showCount=0,phase='empty';
let width=1,height=1,editorWidth=1,editorHeight=1;
let frame=null,lastTime=0,motionElapsed=0,holdTimer=null,flashTimer=null,holdRemaining=FIXED.holdMs,gifRemaining=0,holdStarted=0,sceneIndex=0,materialIndex=0,transitionFrom=0,progress=0,flash=0;
let quality=0,slowFrames=0,jobId=0,batchId=0,worker=null,currentJob=null,buildWarning='';
let cameraStream=null,cameraRequest=0,cameraPending=false,cameraWanted=false;
let tapCandidate=null;
const moving=()=>['arriving','morphing','departing'].includes(phase);
const visible=()=>['arriving','morphing','departing','holding','gif','ready'].includes(phase);
function message(text='',error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function requestRender(){if(frame===null&&!document.hidden)frame=requestAnimationFrame(render);}
function active(){return images[activeImage];}
function validSelection(slot=active()){return !!slot?.selection&&slot.selection.width*slot.source.naturalWidth>=9&&slot.selection.height*slot.source.naturalHeight>=9;}
function ui(){
  const busy=['loading','building','arriving','holding','gif','morphing','departing'].includes(phase);
  $('start').disabled=!images.some(Boolean)||!!selectionDrag||busy;
  $('start').textContent=phase==='building'?'輪郭を抽出中…':moving()||phase==='holding'||phase==='gif'?'ショーを再生中…':['ready','ended'].includes(phase)?'もう一度再生':'スタート';
  $('reselect').disabled=!active()||active().gif||phase==='loading';
  $('selectionPanel').hidden=!images.some(slot=>slot&&!slot.gif);
  $('selectionHelp').textContent=validSelection()?'選択した範囲を使います。「画像全体を使う」で選択を解除できます。':'必要な場合だけ、表示する範囲を選べます。選ばなければ画像全体を使います。';
  for(let i=0;i<3;i++){
    const tab=$('imageTabs').querySelector(`[data-slot="${i}"]`);tab.hidden=!images[i]||images[i].gif;tab.classList.toggle('active',i===activeImage);
  }
  $('imageTabs').hidden=images.filter(slot=>slot&&!slot.gif).length<2;
  const labels={empty:'画像を選んではじめましょう',loading:'画像を読み込み中',editing:'スタートでショーを再生',building:'画像を解析しています',arriving:'ドローンが集合しています',holding:`素材${materialIndex+1}を表示中`,gif:`素材${materialIndex+1}のGIFを再生中`,morphing:`素材${materialIndex+1}へ変形中`,ready:`使用ドローン：${showCount}機`,departing:'ドローンが退場しています',ended:`ショー終了 · 使用ドローン：${showCount}機`};
  $('stateLabel').textContent=labels[phase];
}
function displayDpr(){const cap=navigator.deviceMemory&&navigator.deviceMemory<=4?1.25:1.5;return Math.min(devicePixelRatio||1,quality>=3?1:quality>=2?1.25:cap);}
function resize(){const r=stage.getBoundingClientRect();width=r.width;height=r.height;const dpr=displayDpr();canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);renderer.resize(canvas.width,canvas.height,dpr);requestRender();}
new ResizeObserver(resize).observe(stage);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();if(frame!==null)cancelAnimationFrame(frame);frame=null;lastTime=0;});
canvas.addEventListener('webglcontextrestored',()=>{renderer=createRenderer(canvas);renderer.setFrames(frames);if(frames.length){if(phase==='arriving')renderer.scatter();else if(phase==='morphing')renderer.setSegment(transitionFrom,sceneIndex);else if(phase==='departing')renderer.depart(sceneIndex);else renderer.setSegment(sceneIndex,sceneIndex);}resize();});
function resizeEditor(){const r=editorStage.getBoundingClientRect();if(!r.width||!r.height)return;editorWidth=r.width;editorHeight=r.height;const dpr=Math.min(devicePixelRatio||1,1.5);editor.width=Math.round(r.width*dpr);editor.height=Math.round(r.height*dpr);editorCtx.setTransform(dpr,0,0,dpr,0,0);requestRender();}
new ResizeObserver(resizeEditor).observe(editorStage);$('selectionPanel').addEventListener('toggle',resizeEditor);
function imageRect(){const slot=active();if(!slot)return null;const source=slot.source,ratio=Math.min((editorWidth-36)/source.naturalWidth,(editorHeight-36)/source.naturalHeight),w=source.naturalWidth*ratio,h=source.naturalHeight*ratio;return {x:(editorWidth-w)/2,y:(editorHeight-h)/2,w,h};}
function selectionCorners(rect){return [{name:'nw',x:rect.x,y:rect.y},{name:'ne',x:rect.x+rect.width,y:rect.y},{name:'sw',x:rect.x,y:rect.y+rect.height},{name:'se',x:rect.x+rect.width,y:rect.y+rect.height}];}
function drawSelection(){
  const ctx=editorCtx;ctx.clearRect(0,0,editorWidth,editorHeight);
  const slot=active(),r=imageRect();if(!r)return;
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
  ctx.fillStyle='#283141';ctx.fillRect(r.x,r.y,r.w,r.h);ctx.fillStyle='#1b2431';for(let y=0;y<r.h;y+=16)for(let x=0;x<r.w;x+=16)if((Math.floor(x/16)+Math.floor(y/16))%2===0)ctx.fillRect(r.x+x,r.y+y,16,16);
  ctx.drawImage(slot.source,r.x,r.y,r.w,r.h);ctx.restore();
  const selection=slot.selection;if(!selection)return;
  const s={x:r.x+selection.x*r.w,y:r.y+selection.y*r.h,w:selection.width*r.w,h:selection.height*r.h};
  ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(r.x,r.y,r.w,s.y-r.y);ctx.fillRect(r.x,s.y+s.h,r.w,r.y+r.h-s.y-s.h);ctx.fillRect(r.x,s.y,s.x-r.x,s.h);ctx.fillRect(s.x+s.w,s.y,r.x+r.w-s.x-s.w,s.h);
  ctx.strokeStyle='#beff7a';ctx.lineWidth=2;ctx.strokeRect(s.x,s.y,s.w,s.h);
  for(const c of selectionCorners(selection)){ctx.beginPath();ctx.arc(r.x+c.x*r.w,r.y+c.y*r.h,7,0,Math.PI*2);ctx.fillStyle='#beff7a';ctx.fill();ctx.strokeStyle='#10200d';ctx.lineWidth=2;ctx.stroke();}
}
function analysisRaster(slot,limit=512){const source=slot.source,bounds=pixelBounds(slot.selection||{x:0,y:0,width:1,height:1},source.naturalWidth,source.naturalHeight),ratio=Math.min(1,limit/Math.max(bounds.width,bounds.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bounds.width*ratio));c.height=Math.max(1,Math.round(bounds.height*ratio));const cc=c.getContext('2d',{willReadFrequently:true});if(!cc)throw Error('画像解析用Canvasを作成できませんでした。');cc.drawImage(source,bounds.x,bounds.y,bounds.width,bounds.height,0,0,c.width,c.height);const raster=cc.getImageData(0,0,c.width,c.height);return {pixels:raster.data.buffer,width:raster.width,height:raster.height};}
function spendHold(elapsed=Math.max(0,performance.now()-holdStarted)){holdRemaining=Math.max(0,holdRemaining-elapsed);if(phase==='gif')gifRemaining=Math.max(0,gifRemaining-elapsed);}
function cancelHold(){if(holdTimer!==null){clearTimeout(holdTimer);holdTimer=null;spendHold();}if(flashTimer!==null){clearTimeout(flashTimer);flashTimer=null;flash=0;}stage.classList.remove('shimmer');}
function invalidate(){jobId++;currentJob=null;buildWarning='';tapCandidate=null;cancelHold();if(frame!==null)cancelAnimationFrame(frame);frame=null;frames=[];materials=[];showCount=0;renderer.setFrames([]);renderer.clear();progress=0;motionElapsed=0;lastTime=0;}
function edit(){invalidate();phase=images.some(Boolean)?'editing':'empty';message();ui();requestRender();}
function effect(){const lowTrail=quality>=1||stage.classList.contains('ar'),departing=phase==='departing';return {motion:moving()&&!departing?(lowTrail?0.4:1):0,flash,alpha:1,exitTime:departing?motionElapsed/1000:-1,time:performance.now()/1000};}
function drawShow(){if(!visible()){renderer.clear();return;}const unit=Math.min(width*.86,height*.86),density=showCount>=1900?.59:showCount>=1400?.73:showCount>=900?.92:1,size=FIXED.dotSize*11*density*(quality>=1?.85:1)*(stage.classList.contains('ar')?.88:1);renderer.draw(progress,width,height,0,0,unit,size,{...effect(),glow:showCount>=1900?.52:showCount>=1400?.72:1});}
function ease(t){return t*t*t*(t*(t*6-15)+10);}
function gifDelay(){const material=materials[materialIndex],index=sceneIndex-material.start;return Math.max(70,Math.min(FIXED.holdMs,material.durations[index]||100));}
function scheduleHold(){if(document.hidden||holdTimer!==null)return;holdStarted=performance.now();const duration=phase==='gif'?Math.min(holdRemaining,gifRemaining):holdRemaining;holdTimer=setTimeout(()=>{holdTimer=null;spendHold(Math.max(duration,performance.now()-holdStarted));advanceTimeline();},duration);}
function enterHold(){const material=materials[materialIndex];phase=material.kind==='gif'?'gif':'holding';progress=1;flash=.55;drawShow();flashTimer=setTimeout(()=>{flashTimer=null;flash=0;if(phase==='holding'||phase==='gif')drawShow();},180);gifRemaining=phase==='gif'?FIXED.holdMs:0;holdRemaining=phase==='gif'?gifDelay():FIXED.holdMs;stage.classList.toggle('shimmer',phase==='holding');ui();scheduleHold();}
function nextMaterial(){stage.classList.remove('shimmer');if(materialIndex<materials.length-1){transitionFrom=sceneIndex;materialIndex++;sceneIndex=materials[materialIndex].start;renderer.setSegment(transitionFrom,sceneIndex);phase='morphing';motionElapsed=0;lastTime=0;progress=0;ui();requestRender();}else{phase='ready';progress=1;ui();requestRender();}}
function advanceTimeline(){if(phase==='gif'){
    const material=materials[materialIndex];if(gifRemaining<=1){if(materialIndex===materials.length-1){sceneIndex=material.end;renderer.setSegment(sceneIndex,sceneIndex);drawShow();}nextMaterial();return;}
    if(holdRemaining<=1){sceneIndex=sceneIndex<material.end?sceneIndex+1:material.start;renderer.setSegment(sceneIndex,sceneIndex);progress=1;flash=0;drawShow();holdRemaining=gifDelay();ui();}
    scheduleHold();
  }else if(phase==='holding'){if(holdRemaining<=1)nextMaterial();else scheduleHold();}}
function departShow(){cancelHold();renderer.depart(sceneIndex);phase='departing';motionElapsed=0;lastTime=0;progress=0;flash=0;ui();requestRender();}
function render(time){
  frame=null;if($('selectionPanel').open&&!$('selectionPanel').hidden)drawSelection();
  if(moving()){
    const delta=lastTime?Math.max(0,time-lastTime):0;motionElapsed+=delta;lastTime=time;
    if(delta>28)slowFrames++;else slowFrames=Math.max(0,slowFrames-2);
    if(slowFrames>=12&&quality<3){quality++;slowFrames=0;if(quality>=2)resize();}
    const departing=phase==='departing',duration=departing?FIXED.departureMs:FIXED.moveMs,t=Math.min(1,motionElapsed/duration);progress=departing?ease(clamp((motionElapsed-300)/(FIXED.departureMs-300),0,1)):ease(t);flash=departing?0:Math.max(0,(t-.86)/.14)*.55;
    drawShow();if(t>=1){lastTime=0;if(departing){renderer.clear();phase='ended';ui();}else enterHold();}else requestRender();
  }else drawShow();
}
function beginShow(){if(!frames.length)return;cancelHold();renderer.scatter();sceneIndex=materials[0].start;materialIndex=0;transitionFrom=sceneIndex;phase='arriving';motionElapsed=0;lastTime=0;progress=0;flash=0;slowFrames=0;message();ui();requestRender();}
function renderImageList(){
  const list=$('selectedImages');list.replaceChildren();const selected=images.filter(Boolean);list.hidden=!selected.length;
  selected.forEach((slot,i)=>{const row=document.createElement('li'),order=document.createElement('span'),thumb=document.createElement('img'),name=document.createElement('span'),kind=document.createElement('span');
    order.className='order';order.textContent=String(i+1);thumb.src=slot.thumbnail||slot.url;thumb.alt='';name.className='name';name.textContent=slot.fileName;name.title=slot.fileName;kind.className='kind';kind.textContent=slot.gif?'GIF':'静止画';row.append(order,thumb,name,kind);list.append(row);});
  $('fileName').textContent=selected.length===1?selected[0].fileName:selected.length?`${selected.length}素材を選択中`:'選択されていません';
  $('fileName').title=selected.length===1?selected[0].fileName:'';
}
function releaseImages(slots){for(const slot of slots)if(slot?.objectUrl)URL.revokeObjectURL(slot.url);}
function gifThumbnail(source){try{const c=document.createElement('canvas');if(typeof c.toDataURL!=='function')return null;c.width=56;c.height=44;const ratio=Math.min(56/source.naturalWidth,44/source.naturalHeight),w=source.naturalWidth*ratio,h=source.naturalHeight*ratio;c.getContext('2d').drawImage(source,(56-w)/2,(44-h)/2,w,h);return c.toDataURL('image/png');}catch{return null;}}
function openFileImage(file){return new Promise((resolve,reject)=>{let url;try{url=URL.createObjectURL(file);}catch(error){reject(error);return;}
  const source=new Image();let settled=false;const timeout=setTimeout(()=>finish(false),12000);
  function finish(ok){if(settled)return;settled=true;clearTimeout(timeout);source.onload=null;source.onerror=null;
    if(ok&&source.naturalWidth&&source.naturalHeight)resolve({source,url});else{URL.revokeObjectURL(url);reject(new Error('画像を読み込めませんでした'));}}
  source.onload=()=>finish(true);source.onerror=()=>finish(false);try{source.src=url;}catch{finish(false);}
});}
async function decodeFile(file){
  if(!/^image\/(png|jpeg|gif)$/i.test(file.type)&&!(!file.type&&/\.(png|jpe?g|gif)$/i.test(file.name)))throw Error('PNG/JPG/GIFのみ対応');
  if(file.size>32*1024*1024)throw Error('32 MBを超えています');
  let opened;try{opened=await openFileImage(file);}catch{opened=await openFileImage(file);}
  const {source,url}=opened,gif=/\.gif$/i.test(file.name)||file.type==='image/gif';
  return {source,selection:null,fileName:file.name,url,objectUrl:true,gif,file,thumbnail:gif?gifThumbnail(source):null};
}
function failedMaterialText(indices,hasUsable){const numbers=indices.map(i=>`${i+1}番目`).join('・');return `${numbers}の素材を読み取れませんでした。${hasUsable?'成功した素材だけで続行できます。':'PNG・JPG・GIFを選び直してください。'}`;}
async function loadFiles(fileList){
  const files=Array.from(fileList||[]);if(!files.length)return;
  const request=++batchId,chosen=files.slice(0,3),tooMany=files.length>3,previous=images.slice();invalidate();selectionDrag=null;phase='loading';message(tooMany?'素材は3個まで選択できます。先頭の3個を使用します。':'');ui();requestRender();
  const results=await Promise.allSettled(chosen.map(decodeFile));
  if(request!==batchId){for(const result of results)if(result.status==='fulfilled')URL.revokeObjectURL(result.value.url);return;}
  const accepted=results.filter(result=>result.status==='fulfilled').map(result=>result.value),failed=results.flatMap((result,i)=>result.status==='rejected'?[i]:[]);
  if(accepted.length){releaseImages(previous);images.fill(null);accepted.forEach((slot,i)=>images[i]=slot);activeImage=Math.max(0,images.findIndex(slot=>slot&&!slot.gif));}
  phase=images.some(Boolean)?'editing':'empty';renderImageList();resizeEditor();ui();requestRender();
  if(failed.length)message(failedMaterialText(failed,images.some(Boolean)),true);
  else if(tooMany)message('素材は3個まで選択できます。先頭の3個を使用します。');
}
$('imageInput').addEventListener('click',e=>{e.currentTarget.value='';});
$('imageInput').addEventListener('change',e=>{const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value='';loadFiles(files);});
stage.addEventListener('dragover',e=>e.preventDefault());stage.addEventListener('drop',e=>{e.preventDefault();loadFiles(e.dataTransfer.files);});
$('imageTabs').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{const i=Number(button.dataset.slot);if(!images[i]||images[i].gif)return;activeImage=i;selectionDrag=null;ui();requestRender();}));
$('reselect').addEventListener('click',()=>{if(!active())return;active().selection=null;edit();});
$('droneCount').addEventListener('change',edit);
function discardFailed(indices){if(!indices?.length)return;const failed=new Set(indices),kept=[];images.forEach((slot,i)=>{if(!slot)return;if(failed.has(i))releaseImages([slot]);else kept.push(slot);});images.fill(null);kept.forEach((slot,i)=>images[i]=slot);activeImage=Math.max(0,images.findIndex(slot=>slot&&!slot.gif));renderImageList();resizeEditor();}
function receive(result){if(result.id!==jobId)return;const failedNames=result.failedIndices?.map(i=>currentJob?.sourceIndices?.[i]??i);currentJob=null;discardFailed(result.failedIndices);const warnings=[buildWarning,failedNames?.length?failedMaterialText(failedNames,images.some(Boolean)):''].filter(Boolean),warning=warnings.join(' ');buildWarning='';
  if(result.error){phase=images.some(Boolean)?'editing':'empty';message(warning||result.error,true);ui();return;}
  if(!result.frames?.length||result.frames.some(x=>x.length!==result.count)||result.materials?.length!==images.filter(Boolean).length){phase='editing';message('十分な輪郭線が見つかりませんでした。',true);ui();return;}
  frames=result.frames;materials=result.materials;showCount=result.count;renderer.setFrames(frames);beginShow();if(warning)message(warning,true);
}
function fallback(job){setTimeout(async()=>{if(job.id!==jobId)return;try{const [{planMaterials},{decodeGif}]=await Promise.all([import('./show-plan.mjs'),import('./gif.mjs')]);const decoded=[],failedIndices=[];job.materials.forEach((material,i)=>{try{if(material.kind==='static')decoded.push({kind:'static',frames:[material.raster]});else{const gif=decodeGif(material.buffer,{maxFrames:material.maxFrames});decoded.push({kind:'gif',frames:gif.images,durations:gif.durations});}}catch{failedIndices.push(i);}});if(job.id!==jobId)return;if(!decoded.length){receive({id:job.id,error:'画像を解析できませんでした。素材を選び直してください。',failedIndices});return;}receive({id:job.id,...planMaterials(decoded,job.count),failedIndices});}catch(error){receive({id:job.id,error:error.message||'輪郭を処理できませんでした。'});}},0);}
try{worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=e=>receive(e.data);worker.onerror=()=>{worker?.terminate();worker=null;if(currentJob)fallback(currentJob);};}catch{worker=null;}
function runJob(job){currentJob=job;if(worker){try{const materialCopies=job.materials.map(material=>material.kind==='static'?{kind:'static',raster:{...material.raster,pixels:material.raster.pixels.slice(0)}}:{...material,buffer:material.buffer.slice(0)}),transfer=materialCopies.map(material=>material.kind==='static'?material.raster.pixels:material.buffer);worker.postMessage({...job,materials:materialCopies},transfer);}catch{worker.terminate();worker=null;fallback(job);}}else fallback(job);}
$('start').addEventListener('click',async()=>{if(!images.some(Boolean)||selectionDrag||!['editing','ready','ended'].includes(phase))return;if(['ready','ended'].includes(phase)&&frames.length){beginShow();return;}const id=++jobId;try{$('selectionPanel').open=false;phase='building';message();ui();const slots=images.filter(Boolean),gifCount=slots.filter(slot=>slot.gif).length,count=Number($('droneCount').value),lowMemory=navigator.deviceMemory&&navigator.deviceMemory<=4,totalBudget=lowMemory?18:24,baseBudget=lowMemory?6:12;
    const prepared=await Promise.allSettled(slots.map(async slot=>{if(!slot.gif){try{await slot.source.decode?.();}catch{}try{return {kind:'static',raster:analysisRaster(slot)};}catch{await new Promise(resolve=>setTimeout(resolve,50));return {kind:'static',raster:analysisRaster(slot,320)};}}const sizeCap=slot.file.size>20*1024*1024?6:slot.file.size>8*1024*1024?8:12,maxFrames=Math.max(2,Math.min(baseBudget,sizeCap,Math.floor(totalBudget/gifCount)));let buffer;try{buffer=await slot.file.arrayBuffer();}catch{buffer=await slot.file.arrayBuffer();}return {kind:'gif',buffer,maxFrames};}));
    if(id!==jobId)return;const failed=prepared.flatMap((result,i)=>result.status==='rejected'?[i]:[]),sourceIndices=prepared.flatMap((result,i)=>result.status==='fulfilled'?[i]:[]),jobMaterials=prepared.filter(result=>result.status==='fulfilled').map(result=>result.value);
    if(failed.length)discardFailed(failed);if(!jobMaterials.length){phase=images.some(Boolean)?'editing':'empty';message(failedMaterialText(failed,false),true);ui();return;}
    buildWarning=failed.length?failedMaterialText(failed,true):'';runJob({id,materials:jobMaterials,count,sourceIndices});if(buildWarning)message(buildWarning,true);
  }catch(error){if(id!==jobId)return;phase='editing';message(error?.message||'画像を読み取れませんでした。もう一度選択してください。',true);ui();}});

function selectionPoint(e){const b=editor.getBoundingClientRect(),r=imageRect();return {x:(e.clientX-b.left-r.x)/r.w,y:(e.clientY-b.top-r.y)/r.h};}
editor.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;const slot=active();if(!slot||phase==='loading'||selectionDrag)return;const p=selectionPoint(e),r=imageRect(),selection=slot.selection;let corner=null;
  if(selection){const hit=selectionCorners(selection).map(c=>({...c,distance:Math.hypot((p.x-c.x)*r.w,(p.y-c.y)*r.h)})).sort((a,b)=>a.distance-b.distance)[0];if(hit.distance<=24)corner=hit.name;}
  if(!corner&&(p.x<0||p.x>1||p.y<0||p.y>1))return;const inside=selection&&p.x>=selection.x&&p.x<=selection.x+selection.width&&p.y>=selection.y&&p.y<=selection.y+selection.height;
  selectionDrag={id:e.pointerId,start:p,original:selection?{...selection}:null,mode:corner?'resize':inside?'move':'create',corner};if(selectionDrag.mode==='create')slot.selection=rectFromPoints(p,p);invalidate();phase='editing';editor.setPointerCapture(e.pointerId);message();ui();});
editor.addEventListener('pointermove',e=>{const slot=active();if(!slot||phase!=='editing'||selectionDrag?.id!==e.pointerId)return;const raw=selectionPoint(e),p={x:clamp(raw.x,0,1),y:clamp(raw.y,0,1)},d=selectionDrag,r=imageRect();slot.selection=d.mode==='create'?rectFromPoints(d.start,p):d.mode==='move'?moveRect(d.original,raw.x-d.start.x,raw.y-d.start.y):resizeRect(d.original,d.corner,p,Math.max(9/slot.source.naturalWidth,10/r.w),Math.max(9/slot.source.naturalHeight,10/r.h));requestRender();});
function endPointer(e){if(selectionDrag?.id===e.pointerId){const slot=active();if(e.type==='pointercancel')slot.selection=selectionDrag.original;selectionDrag=null;if(!validSelection())slot.selection=null;ui();requestRender();}}
for(const type of ['pointerup','pointercancel','lostpointercapture'])editor.addEventListener(type,endPointer);
document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;if(!['holding','gif','ready'].includes(phase)||e.target.closest?.('button,input,select,label,summary,#editor'))return;
  tapCandidate=tapCandidate?null:{id:e.pointerId,x:e.clientX,y:e.clientY,scene:sceneIndex,material:materialIndex,phase};
});
document.addEventListener('pointermove',e=>{if(tapCandidate?.id===e.pointerId&&Math.hypot(e.clientX-tapCandidate.x,e.clientY-tapCandidate.y)>12)tapCandidate=null;});
document.addEventListener('pointercancel',()=>{tapCandidate=null;});
document.addEventListener('pointerup',e=>{const tap=tapCandidate;tapCandidate=null;if(!tap||tap.id!==e.pointerId||tap.material!==materialIndex||(tap.phase!=='gif'&&tap.scene!==sceneIndex)||!['holding','gif','ready'].includes(phase))return;
  if(materialIndex<materials.length-1){cancelHold();nextMaterial();return;}
  departShow();
});
function cameraUI(ar){stage.classList.toggle('ar',ar);$('arMode').classList.toggle('active',ar);$('nightMode').classList.toggle('active',!ar);$('arMode').setAttribute('aria-pressed',String(ar));$('nightMode').setAttribute('aria-pressed',String(!ar));ui();requestRender();}
function stopCamera(keepMode=false){cameraWanted=keepMode;cameraRequest++;cameraPending=false;cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;video.srcObject=null;cameraUI(keepMode);}
async function startCamera(){cameraWanted=true;if(cameraStream||cameraPending)return;if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){message('カメラを使うにはHTTPSのページを開いてください。',true);return;}const request=++cameraRequest;cameraPending=true;ui();message('カメラの使用を許可してください。');let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});if(request!==cameraRequest){stream.getTracks().forEach(t=>t.stop());return;}cameraStream=stream;video.srcObject=stream;await video.play();if(request!==cameraRequest)return;cameraUI(true);message();for(const t of stream.getVideoTracks())t.addEventListener('ended',()=>{if(cameraStream===stream){stopCamera();message('カメラが停止しました。ARを押して再開できます。');}});}
  catch(e){stream?.getTracks().forEach(t=>t.stop());if(request!==cameraRequest)return;stopCamera();message(e.name==='NotAllowedError'?'ブラウザのサイト設定でカメラを許可して、ARを押してください。':e.name==='NotFoundError'?'カメラが見つかりません。カメラのある端末でお試しください。':'カメラを開始できません。他のカメラアプリを閉じて、もう一度お試しください。',true);}
  finally{if(request===cameraRequest){cameraPending=false;ui();}}
}
$('arMode').addEventListener('click',startCamera);$('nightMode').addEventListener('click',()=>{stopCamera();message();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(frame!==null)cancelAnimationFrame(frame);frame=null;lastTime=0;cancelHold();if(cameraStream||cameraPending)stopCamera(true);}else{if(cameraWanted)startCamera();if(phase==='holding'||phase==='gif'){stage.classList.toggle('shimmer',phase==='holding');scheduleHold();}requestRender();}});
window.addEventListener('pagehide',()=>{cancelHold();stopCamera();});
async function loadSamples(){
  const request=++batchId,names=[['drone.png','サンプル：ドローン'],['cat.png','サンプル：猫'],['flower.png','サンプル：花']];phase='loading';ui();
  const results=await Promise.allSettled(names.map(([fileName,label])=>new Promise((resolve,reject)=>{const source=new Image(),url=new URL(`./samples/${fileName}`,import.meta.url).href;source.onload=()=>resolve({source,url,selection:null,fileName:label,sample:true});source.onerror=reject;source.src=url;})));
  if(request!==batchId)return;const loaded=results.filter(r=>r.status==='fulfilled').map(r=>r.value);loaded.forEach((slot,i)=>images[i]=slot);phase=loaded.length?'editing':'empty';renderImageList();ui();requestRender();
}
resize();resizeEditor();ui();loadSamples();
