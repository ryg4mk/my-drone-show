// GIF89a decoder used inside the analysis worker. Frames are composited before
// sampling, so partial image blocks and disposal do not become separate shapes.
const word=(bytes,i)=>bytes[i]|(bytes[i+1]<<8);

function lzw(bytes,minSize,length){
  const clear=1<<minSize,end=clear+1,prefix=new Uint16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4096),out=new Uint8Array(length);
  for(let i=0;i<clear;i++)suffix[i]=i;
  let bits=0,bitCount=0,at=0,size=minSize+1,next=end+1,old=-1,first=0,pos=0;
  while(pos<length){
    while(bitCount<size){if(at>=bytes.length)return out;bits|=bytes[at++]<<bitCount;bitCount+=8;}
    let code=bits&((1<<size)-1);bits>>>=size;bitCount-=size;
    if(code===clear){size=minSize+1;next=end+1;old=-1;continue;}
    if(code===end)break;
    const original=code;let top=0;
    if(code>=next){if(old<0)throw Error('GIFの圧縮データを読み取れませんでした。');stack[top++]=first;code=old;}
    while(code>=clear){if(code>=4096||top>=4095)throw Error('GIFの圧縮データを読み取れませんでした。');stack[top++]=suffix[code];code=prefix[code];}
    first=suffix[code];stack[top++]=first;
    while(top&&pos<length)out[pos++]=stack[--top];
    if(old>=0&&next<4096){prefix[next]=old;suffix[next]=first;next++;if(next===(1<<size)&&size<12)size++;}
    old=original;
  }
  return out;
}

function blocks(bytes,start){const chunks=[];let size=0,at=start;while(at<bytes.length){const n=bytes[at++];if(!n)break;if(at+n>bytes.length)throw Error('GIFが途中で切れています。');chunks.push(bytes.subarray(at,at+n));size+=n;at+=n;}const joined=new Uint8Array(size);let p=0;for(const chunk of chunks){joined.set(chunk,p);p+=chunk.length;}return {data:joined,next:at};}

export function parseGif(buffer){
  const bytes=new Uint8Array(buffer);if(bytes.length<13||String.fromCharCode(...bytes.subarray(0,6)).slice(0,3)!=='GIF')throw Error('GIF形式ではありません。');
  const width=word(bytes,6),height=word(bytes,8);if(!width||!height||width*height>1200000)throw Error('GIFの画像サイズが大きすぎます。');
  let at=13;const globalSize=bytes[10]&128?3*(1<<((bytes[10]&7)+1)):0,global=bytes.subarray(at,at+globalSize);at+=globalSize;
  const frames=[];let gce={delay:100,disposal:0,transparent:-1};
  while(at<bytes.length&&frames.length<300){
    const block=bytes[at++];if(block===0x3b)break;
    if(block===0x21){const kind=bytes[at++];if(kind===0xf9){const n=bytes[at++];if(n<4||at+n>=bytes.length)throw Error('GIFの制御情報が壊れています。');const packed=bytes[at],delay=word(bytes,at+1)*10;gce={delay:Math.max(40,delay||100),disposal:(packed>>2)&7,transparent:packed&1?bytes[at+3]:-1};at+=n+1;}else{const n=bytes[at++];at+=n;at=blocks(bytes,at).next;}continue;}
    if(block!==0x2c)throw Error('GIFの画像データが壊れています。');
    if(at+9>bytes.length)throw Error('GIFが途中で切れています。');
    const x=word(bytes,at),y=word(bytes,at+2),w=word(bytes,at+4),h=word(bytes,at+6),packed=bytes[at+8];at+=9;
    const localSize=packed&128?3*(1<<((packed&7)+1)):0,palette=localSize?bytes.subarray(at,at+localSize):global;at+=localSize;
    const minSize=bytes[at++],data=blocks(bytes,at);at=data.next;
    if(!w||!h||w*h>1200000||minSize<2||minSize>8)throw Error('GIFのフレームを読み取れませんでした。');
    frames.push({x,y,w,h,interlace:!!(packed&64),palette,minSize,data:data.data,...gce});gce={delay:100,disposal:0,transparent:-1};
  }
  if(!frames.length)throw Error('GIFに画像フレームがありません。');
  return {width,height,frames};
}

function rasterize(pixels,width,height,longEdge){
  const ratio=Math.min(1,longEdge/Math.max(width,height)),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio)),out=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(width-1,Math.floor((x+.5)*width/w)),sy=Math.min(height-1,Math.floor((y+.5)*height/h)),a=(sy*width+sx)*4,b=(y*w+x)*4;out[b]=pixels[a];out[b+1]=pixels[a+1];out[b+2]=pixels[a+2];out[b+3]=pixels[a+3];}
  return {pixels:out.buffer,width:w,height:h};
}
function difference(a,b){const x=new Uint8ClampedArray(a.pixels),y=new Uint8ClampedArray(b.pixels),stride=Math.max(4,Math.floor(x.length/1024/4)*4);let total=0,n=0;for(let i=0;i<x.length;i+=stride){total+=Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2])+Math.abs(x[i+3]-y[i+3]);n++;}return total/Math.max(1,n);}

export function decodeGif(buffer,{maxFrames=12,longEdge=320}={}){
  const gif=parseGif(buffer),{width,height,frames}=gif,composite=new Uint8ClampedArray(width*height*4),bins=new Map(),cumulative=new Float64Array(frames.length+1);
  let first=null,last=null,previous=null;
  for(let index=0;index<frames.length;index++){
    const f=frames[index],before=f.disposal===3?composite.slice():null,indices=lzw(f.data,f.minSize,f.w*f.h);let source=0;
    const rows=[];if(f.interlace){for(const [start,step] of [[0,8],[4,8],[2,4],[1,2]])for(let y=start;y<f.h;y+=step)rows.push(y);}else for(let y=0;y<f.h;y++)rows.push(y);
    for(const row of rows)for(let x=0;x<f.w;x++){
      const value=indices[source++],dx=f.x+x,dy=f.y+row;if(value===f.transparent||dx>=width||dy>=height)continue;
      const c=value*3,d=(dy*width+dx)*4;if(c+2>=f.palette.length)continue;composite[d]=f.palette[c];composite[d+1]=f.palette[c+1];composite[d+2]=f.palette[c+2];composite[d+3]=255;
    }
    cumulative[index+1]=cumulative[index]+f.delay;
    const raster=rasterize(composite,width,height,longEdge),change=previous?difference(previous,raster):Infinity;
    if(index===0)first={index,raster};
    else if(index===frames.length-1)last={index,raster};
    else if(maxFrames>2&&change>6){
      const bin=Math.floor((index-1)*Math.max(1,maxFrames-2)/Math.max(1,frames.length-2)),best=bins.get(bin);
      if(!best||change>best.change)bins.set(bin,{index,raster,change});
    }
    previous=raster;
    if(f.disposal===2){for(let y=f.y;y<Math.min(height,f.y+f.h);y++)for(let x=f.x;x<Math.min(width,f.x+f.w);x++)composite.fill(0,(y*width+x)*4,(y*width+x)*4+4);}
    else if(before)composite.set(before);
  }
  const chosen=[first,...bins.values(),last].filter(Boolean).sort((a,b)=>a.index-b.index).slice(0,maxFrames);
  const images=chosen.map(item=>item.raster),durations=chosen.map((item,i)=>cumulative[chosen[i+1]?.index??frames.length]-cumulative[item.index]);
  return {images,durations};
}
