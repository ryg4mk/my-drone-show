import assert from 'node:assert/strict';
import test from 'node:test';
import {extractLines,planShow} from '../sampler.mjs';
import {planMaterials} from '../show-plan.mjs';

const width=128,height=128;
function illustration(variant=0){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set([255,255,255,255],i);
  const pixel=(x,y,r=24,g=44,b=82)=>{const i=(y*width+x)*4;data.set([r,g,b,255],i);};
  const left=19+variant*3,right=108-variant*3,top=18+variant*2,bottom=108-variant*2;
  for(let x=left;x<=right;x++)for(let thick=0;thick<2;thick++){pixel(x,top+thick);pixel(x,bottom-thick);}
  for(let y=top;y<=bottom;y++)for(let thick=0;thick<2;thick++){pixel(left+thick,y);pixel(right-thick,y);}
  for(let x=39;x<52;x++)for(let thick=0;thick<2;thick++){pixel(x,51+thick,180,40,40);pixel(x+37,51+thick,180,40,40);}
  for(let x=50;x<=77;x++)pixel(x,82+Math.round(Math.sin((x-50)/27*Math.PI)*5),180,40,40);
  return {pixels:data.buffer,width,height};
}
const pointsFor=(input,count)=>planShow(new Uint8ClampedArray(input.pixels),width,height,count);

test('a sparse but meaningful outline can supply exactly 2000 distinct targets',()=>{
  const input=illustration(),data=new Uint8ClampedArray(input.pixels);
  const raw=extractLines(data,width,height,1000).candidates;
  assert.ok(raw.length>20&&raw.length<1000,`expected fewer than 1000 raw edge pixels, got ${raw.length}`);
  const result=pointsFor(input,2000);
  assert.equal(result.count,2000);
  assert.equal(result.points.length,2000);
  const unique=new Set(result.points.map(p=>`${p.x.toFixed(7)},${p.y.toFixed(7)}`));
  assert.equal(unique.size,2000,'resampling must not duplicate a target coordinate');
  // The middle of the flat white area must remain empty.
  assert.equal(result.points.filter(p=>Math.abs(p.x)<.09&&Math.abs(p.y)<.09).length,0);
});

test('three different source complexities share exact manual and automatic counts',()=>{
  const inputs=[illustration(0),illustration(1),illustration(2)];
  const materials=inputs.map(input=>({kind:'static',frames:[input]}));
  const manual=planMaterials(materials,2000);
  assert.equal(manual.count,2000);
  assert.deepEqual(manual.frames.map(frame=>frame.length),[2000,2000,2000]);
  const automatic=planMaterials(materials);
  assert.ok(automatic.count>=300&&automatic.count<=2000);
  assert.ok(automatic.frames.every(frame=>frame.length===automatic.count));
});

test('blank transparent material remains an actual no-subject error',()=>{
  const blank={pixels:new Uint8ClampedArray(width*height*4).buffer,width,height};
  assert.equal(pointsFor(blank,2000).count,0);
  assert.throws(()=>planMaterials([{kind:'static',frames:[illustration()]},{kind:'static',frames:[blank]}],2000),/輪郭/);
});
