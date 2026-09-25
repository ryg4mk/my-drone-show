// Image-characteristics heuristic; no identity/face recognition or remote model.
export function classifyImage(data,width,height){
  let flat=0,total=0,soft=0;const colors=new Set();
  for(let y=1;y<height-1;y+=2)for(let x=1;x<width-1;x+=2){const i=(y*width+x)*4;if(data[i+3]<128)continue;
    colors.add((data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4));
    let d=0;for(let c=0;c<3;c++)d+=Math.abs(data[i+c]-data[i+4+c])+Math.abs(data[i+c]-data[i+width*4+c]);d/=6;total++;if(d<2.8)flat++;if(d>=2.8&&d<24)soft++;
  }
  const flatRatio=flat/Math.max(1,total),textureRatio=soft/Math.max(1,total);
  return {kind:colors.size>90&&flatRatio<.70&&textureRatio>.20?'photo':'illustration',flatRatio,textureRatio,colors:colors.size};
}

export function simplifyPhoto(data,width,height){
  const ratio=Math.min(1,320/Math.max(width,height)),w=Math.round(width*ratio),h=Math.round(height*ratio),original=new Uint8ClampedArray(w*h*4);
  // Area-average before filtering to avoid aliasing of fur and fine patterns.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let count=0,a=0,r=0,g=0,b=0;for(let sy=Math.floor(y/ratio);sy<Math.min(height,Math.ceil((y+1)/ratio));sy++)for(let sx=Math.floor(x/ratio);sx<Math.min(width,Math.ceil((x+1)/ratio));sx++){const i=(sy*width+sx)*4,alpha=data[i+3]/255;count++;a+=alpha;r+=data[i]*alpha;g+=data[i+1]*alpha;b+=data[i+2]*alpha;}const i=(y*w+x)*4;if(a){original[i]=r/a;original[i+1]=g/a;original[i+2]=b/a;}original[i+3]=255*a/count;}
  let smooth=new Uint8ClampedArray(original);const spatial=[];for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)spatial.push({dx,dy,s:Math.exp(-(dx*dx+dy*dy)/10)});
  // Bilateral smoothing preserves large contrast boundaries but merges texture.
  for(let pass=0;pass<3;pass++){const out=new Uint8ClampedArray(smooth);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(!original[i+3])continue;let total=0,r=0,g=0,b=0;
    for(const {dx,dy,s} of spatial){const xx=Math.max(0,Math.min(w-1,x+dx)),yy=Math.max(0,Math.min(h-1,y+dy)),j=(yy*w+xx)*4;if(!original[j+3])continue;const distance=(smooth[i]-smooth[j])**2+(smooth[i+1]-smooth[j+1])**2+(smooth[i+2]-smooth[j+2])**2,weight=s*Math.exp(-distance/(2*42*42));total+=weight;r+=smooth[j]*weight;g+=smooth[j+1]*weight;b+=smooth[j+2]*weight;}out[i]=r/total;out[i+1]=g/total;out[i+2]=b/total;}smooth=out;}
  // A small global palette groups similar colors. Blend to avoid hard false
  // contours across a smooth lighting gradient.
  const samples=[];for(let i=0;i<smooth.length;i+=4*13)if(smooth[i+3]>128)samples.push([smooth[i],smooth[i+1],smooth[i+2]]);
  const palette=[];if(samples.length)palette.push(samples[Math.floor(samples.length/2)].slice());
  const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
  while(palette.length<16&&palette.length<samples.length){let best=samples[0],score=-1;for(const p of samples){const d=Math.min(...palette.map(q=>distance(p,q)));if(d>score){score=d;best=p;}}palette.push(best.slice());}
  function nearest(p){let best=0,d=Infinity;for(let k=0;k<palette.length;k++){const v=distance(p,palette[k]);if(v<d){d=v;best=k;}}return best;}
  for(let pass=0;pass<5;pass++){const sums=palette.map(()=>[0,0,0,0]);for(const p of samples){const sum=sums[nearest(p)];for(let c=0;c<3;c++)sum[c]+=p[c];sum[3]++;}sums.forEach((sum,k)=>{if(sum[3])for(let c=0;c<3;c++)palette[k][c]=sum[c]/sum[3];});}
  const reduced=new Uint8ClampedArray(smooth);for(let i=0;i<smooth.length;i+=4){if(!smooth[i+3]||!palette.length)continue;const p=[smooth[i],smooth[i+1],smooth[i+2]],color=palette[nearest(p)];for(let c=0;c<3;c++)reduced[i+c]=smooth[i+c]*.55+color[c]*.45;}
  return {data:reduced,original,width:w,height:h};
}

export function surfacePoints(original,width,height,lines,count){
  if(!lines.length||!count)return [];const size=Math.max(width,height),edge=lines.map(p=>({x:p.x*size+width/2,y:p.y*size+height/2})),candidates=[];
  const margin=Math.max(4,Math.ceil(Math.min(width,height)*.02)),step=6;
  for(let y=margin;y<height-margin;y+=step)for(let x=margin;x<width-margin;x+=step){const i=(y*width+x)*4;if(original[i+3]<128)continue;
    // Only fill small gaps near meaningful contours, within their envelope.
    // This is deliberately not a whole-image uniform grid fallback.
    let near=Infinity,left=false,right=false,above=false,below=false;
    for(const p of edge){near=Math.min(near,(x-p.x)**2+(y-p.y)**2);if(Math.abs(p.y-y)<25){left||=p.x<x;right||=p.x>x;}if(Math.abs(p.x-x)<25){above||=p.y<y;below||=p.y>y;}}
    if(near<25||near>900||!(left&&right&&above&&below))continue;
    const central=1-.35*Math.hypot((x-width/2)/(width/2),(y-height*.45)/(height/2));candidates.push({x,y,weight:Math.max(.3,central)});
  }
  const selected=[],minDistance=new Float32Array(candidates.length).fill(Infinity);for(let k=0;k<Math.min(count,candidates.length);k++){let best=-1,score=-1;for(let i=0;i<candidates.length;i++){const p=candidates[i];if(p.used)continue;const s=(k?minDistance[i]:1)*p.weight;if(s>score){score=s;best=i;}}const p=candidates[best];p.used=true;const i=(p.y*width+p.x)*4;selected.push({x:(p.x+.5-width/2)/size,y:(p.y+.5-height/2)/size,r:original[i],g:original[i+1],b:original[i+2]});for(let i=0;i<candidates.length;i++){const q=candidates[i];minDistance[i]=Math.min(minDistance[i],(p.x-q.x)**2+(p.y-q.y)**2);}}
  return selected;
}
