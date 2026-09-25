import {classifyImage,simplifyPhoto,surfacePoints} from './photo.mjs';
// Line-only sampling: RGB/alpha gradients -> thin edges -> connected lines ->
// spatially distributed points. Uniform regions are NEVER fallback candidates.
export function extractLines(data,width,height,count=500,photo=false){
  const n=width*height,detail=count===1000,margin=Math.max(3,Math.ceil(Math.min(width,height)*.008));
  if(width<9||height<9)return {candidates:[],components:0,margin};
  const channels=Array.from({length:4},()=>new Float32Array(n));
  for(let i=0;i<n;i++){const a=data[i*4+3]/255;for(let c=0;c<3;c++)channels[c][i]=data[i*4+c]*a;channels[3][i]=255*a;}
  function blur(input){
    const temp=new Float32Array(n),out=new Float32Array(n),k=[1,4,6,4,1];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=0;for(let j=-2;j<=2;j++)v+=input[y*width+Math.max(0,Math.min(width-1,x+j))]*k[j+2];temp[y*width+x]=v/16;}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=0;for(let j=-2;j<=2;j++)v+=temp[Math.max(0,Math.min(height-1,y+j))*width+x]*k[j+2];out[y*width+x]=v/16;}return out;
  }
  const smooth=channels.map(c=>detail?blur(c):blur(blur(c)));
  const strength=new Float32Array(n),direction=new Uint8Array(n),alphaEdge=new Uint8Array(n),values=[];
  for(let y=margin;y<height-margin;y++)for(let x=margin;x<width-margin;x++){
    const i=y*width+x;let best=0,gx=0,gy=0;
    for(let c=0;c<4;c++){
      const s=smooth[c],a=i-width,b=i+width;
      const dx=(-s[a-1]+s[a+1]-2*s[i-1]+2*s[i+1]-s[b-1]+s[b+1])/4;
      const dy=(-s[a-1]-2*s[a]-s[a+1]+s[b-1]+2*s[b]+s[b+1])/4;
      const mag=Math.hypot(dx,dy)*(c===3?1.12:1);
      if(mag>best){best=mag;gx=dx;gy=dy;alphaEdge[i]=c===3?1:0;}
    }
    strength[i]=best;
    let angle=Math.atan2(gy,gx)*180/Math.PI;if(angle<0)angle+=180;
    direction[i]=angle<22.5||angle>=157.5?0:angle<67.5?1:angle<112.5?2:3;
    if(best>5)values.push(best);
  }
  values.sort((a,b)=>a-b);const reference=values[Math.floor(values.length*.85)]||0;
  const high=Math.max(photo?(detail?20:27):(detail?13:23),reference*(photo?(detail?.32:.42):(detail?.22:.34))),low=high*(photo?.65:(detail?.48:.58));
  const thin=new Float32Array(n),offsets=[1,width+1,width,width-1];
  for(let y=margin;y<height-margin;y++)for(let x=margin;x<width-margin;x++){
    const i=y*width+x,d=offsets[direction[i]],m=strength[i];
    if(m>=low&&m>=strength[i-d]&&m>strength[i+d])thin[i]=m;
  }
  // Suppress long straight frame segments close to the canvas boundary.
  // This is geometric frame rejection, not background-color removal.
  const frameBand=Math.max(margin+1,Math.floor(Math.min(width,height)*.055));
  for(let y=margin;y<height-margin;y++)if(y<frameBand||y>=height-frameBand){let hits=0;for(let x=margin;x<width-margin;x++)if(thin[y*width+x]&&direction[y*width+x]===2)hits++;if(hits>width*.62)for(let x=margin;x<width-margin;x++)if(direction[y*width+x]===2)thin[y*width+x]=0;}
  for(let x=margin;x<width-margin;x++)if(x<frameBand||x>=width-frameBand){let hits=0;for(let y=margin;y<height-margin;y++)if(thin[y*width+x]&&direction[y*width+x]===0)hits++;if(hits>height*.62)for(let y=margin;y<height-margin;y++)if(direction[y*width+x]===0)thin[y*width+x]=0;}
  const visited=new Uint8Array(n),components=[],queue=new Int32Array(n);
  for(let seed=0;seed<n;seed++){
    if(visited[seed]||!thin[seed])continue;let head=0,tail=0;queue[tail++]=seed;visited[seed]=1;
    const pixels=[];let maximum=0,sum=0,minX=width,maxX=0,minY=height,maxY=0;
    while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);pixels.push(i);maximum=Math.max(maximum,thin[i]);sum+=thin[i];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<margin||nx>=width-margin||ny<margin||ny>=height-margin)continue;const j=ny*width+nx;if(!visited[j]&&thin[j]){visited[j]=1;queue[tail++]=j;}}
    }
    const minimum=photo?(detail?8:18):(detail?6:11);
    if(maximum>=high&&pixels.length>=minimum&&Math.max(maxX-minX,maxY-minY)>=minimum/2)components.push({pixels,mean:sum/pixels.length});
  }
  const candidates=[];
  for(let c=0;c<components.length;c++){
    const component=components[c];
    for(const i of component.pixels){
      let x=i%width,y=Math.floor(i/width),source=i;
      // Move an alpha edge to its opaque side; never place a drone on alpha 0.
      if(data[source*4+3]===0){let best=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=(y+dy)*width+x+dx;if(data[j*4+3]>best){best=data[j*4+3];source=j;}}if(!best)continue;x=source%width;y=Math.floor(source/width);}
      if(x<margin||x>=width-margin||y<margin||y>=height-margin)continue;
      // Choose a real color on the edge. Favor chroma, then a visible adjoining
      // color for black ink. No synthetic background color or alpha fill.
      let color=source,bestColor=-1;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=(y+dy)*width+x+dx,p=j*4;if(!data[p+3])continue;const max=Math.max(data[p],data[p+1],data[p+2]),min=Math.min(data[p],data[p+1],data[p+2]),score=(max-min)*2+max*.3-(Math.abs(dx)+Math.abs(dy))*2;if(score>bestColor){bestColor=score;color=j;}}
      candidates.push({x:x+.5,y:y+.5,r:data[color*4],g:data[color*4+1],b:data[color*4+2],weight:1+Math.min(1.4,thin[i]/Math.max(high,1))*.65+Math.min(.55,Math.log2(component.pixels.length+1)/20)+(alphaEdge[i]?.3:0),component:c,strength:thin[i],alphaBoundary:!!alphaEdge[i],componentSize:component.pixels.length,componentMean:component.mean});
    }
  }
  return {candidates,components:components.length,margin,high,low};
}

export function samplePoints(data,width,height,count){
  const edges=extractLines(data,width,height,count>=650?1000:500);
  return placePoints(data,width,height,count,edges.candidates);
}

function placePoints(data,width,height,count,candidates){
  if(!Number.isInteger(count)||count<1||count>2000)throw new Error('Drone limit: 1–2000');
  const unique=new Map();for(const p of candidates){const key=`${p.x},${p.y}`;if(!unique.has(key)||unique.get(key).weight<p.weight)unique.set(key,p);}candidates=[...unique.values()];
  if(!candidates.length)return [];
  const size=Math.max(width,height);
  const output=p=>({x:(p.x-width/2)/size,y:(p.y-height/2)/size,r:p.r,g:p.g,b:p.b});
  // A line is a graph of adjacent edge pixels. Preserve every detected mark,
  // then distribute the remaining drones along its connected segments. This
  // has a fixed cost per segment and does not create a giant candidate array.
  if(candidates.length<count){
    const grid=new Map(candidates.map((p,i)=>[`${Math.floor(p.x)},${Math.floor(p.y)}`,i]));
    const neighbor=(x,y)=>grid.get(`${x},${y}`);
    const segments=[];let totalWeight=0;
    for(const a of candidates){
      const x=Math.floor(a.x),y=Math.floor(a.y);
      for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){
        const j=neighbor(x+dx,y+dy);if(j===undefined)continue;
        const b=candidates[j];if(a.component!==b.component)continue;
        // A corner with an orthogonal connection should not also get a
        // crossing diagonal. It would double the lights at the intersection.
        if(dx&&dy&&[neighbor(x+dx,y),neighbor(x,y+dy)].some(k=>k!==undefined&&candidates[k].component===a.component))continue;
        const mx=Math.floor((a.x+b.x)/2),my=Math.floor((a.y+b.y)/2);
        if(!data[(my*width+mx)*4+3])continue;
        const priority=((a.priority??.7)+(b.priority??.7))/2;
        const weight=Math.hypot(dx,dy)*Math.max(.35,Math.min(3.5,(a.weight+b.weight)/2))*(.75+.5*priority);
        segments.push({a,b,weight,allocated:0,remainder:0});totalWeight+=weight;
      }
    }
    // A dotted but visible drawing can have no adjacent edge pixels. Keep it
    // playable by treating each detected mark as a very short subpixel stroke.
    // This fallback never adds lights to an unrelated flat region.
    if(!segments.length&&candidates.length>=8)for(const p of candidates){
      const a={...p,x:p.x-.22},b={...p,x:p.x+.22};
      const weight=Math.max(.35,Math.min(3.5,p.weight))*.44;
      segments.push({a,b,weight,allocated:0,remainder:0});totalWeight+=weight;
    }
    if(!segments.length)return [];
    const extra=count-candidates.length,result=candidates.map(output);
    let assigned=0;
    for(const segment of segments){const quota=extra*segment.weight/totalWeight;segment.allocated=Math.floor(quota);segment.remainder=quota-segment.allocated;assigned+=segment.allocated;}
    const residual=segments.slice().sort((a,b)=>b.remainder-a.remainder||b.weight-a.weight);
    for(let i=0;i<extra-assigned;i++)residual[i].allocated++;
    for(const {a,b,allocated} of segments)for(let i=0;i<allocated;i++){
      const t=(i+.5)/allocated;
      const color=t<.5?a:b;
      result.push(output({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,r:color.r,g:color.g,b:color.b}));
    }
    return result;
  }
  const nearest=new Float32Array(candidates.length);nearest.fill(Infinity);const used=new Uint8Array(candidates.length),result=[];let best=0;
  // Keep the exact requested count, but consume well-spaced edge locations
  // before adding lights to a crowded section of the same line.
  const spacing=count>=1900?1.7:count>=1400?1.4:1.1,spacing2=spacing*spacing;
  for(let i=1;i<candidates.length;i++)if(candidates[i].weight>candidates[best].weight)best=i;
  for(let k=0;k<count;k++){
    const p=candidates[best];used[best]=1;result.push(output(p));let score=-1,next=0;
    for(let i=0;i<candidates.length;i++){if(used[i])continue;const q=candidates[i],distance=(q.x-p.x)**2+(q.y-p.y)**2;if(distance<nearest[i])nearest[i]=distance;const s=nearest[i]*Math.min(4,q.weight)*(nearest[i]<spacing2?.08:1);if(s>score){score=s;next=i;}}best=next;
  }
  return result;
}

// Estimate a compact rendering budget from meaningful line length, connected
// parts and stability at two smoothing scales, never from image colors alone.
function planLines(data,width,height,photo=false,requestedCount=0){
  const fine=extractLines(data,width,height,1000,photo),coarse=extractLines(data,width,height,500,photo);
  if(!fine.candidates.length)return {points:[],count:0,metrics:{lineLength:0,parts:0}};
  const stable=new Uint8Array(width*height);
  for(const p of coarse.candidates)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const x=Math.floor(p.x)+dx,y=Math.floor(p.y)+dy;if(x>=0&&y>=0&&x<width&&y<height)stable[y*width+x]=1;}
  const rowsMin=new Float32Array(height).fill(Infinity),rowsMax=new Float32Array(height).fill(-Infinity),colsMin=new Float32Array(width).fill(Infinity),colsMax=new Float32Array(width).fill(-Infinity);
  let left=width,right=0,top=height,bottom=0;
  const groups=new Map();
  for(const p of fine.candidates){const x=Math.floor(p.x),y=Math.floor(p.y);rowsMin[y]=Math.min(rowsMin[y],x);rowsMax[y]=Math.max(rowsMax[y],x);colsMin[x]=Math.min(colsMin[x],y);colsMax[x]=Math.max(colsMax[x],y);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);let g=groups.get(p.component);if(!g){g={points:[],left:x,right:x,top:y,bottom:y};groups.set(p.component,g);}g.points.push(p);g.left=Math.min(g.left,x);g.right=Math.max(g.right,x);g.top=Math.min(g.top,y);g.bottom=Math.max(g.bottom,y);}
  const extent=Math.max(right-left,bottom-top,1);
  const ranked=[];
  for(const group of groups.values()){
    const cx=((group.left+group.right)/2-left)/Math.max(right-left,1),cy=((group.top+group.bottom)/2-top)/Math.max(bottom-top,1),span=Math.max(group.right-group.left,group.bottom-group.top);
    // Compact, strong, upper-central marks often describe eyes, mouth, nose,
    // glasses, etc. This is geometric saliency, not a semantic face detector.
    const focal=cx>.18&&cx<.82&&cy>.12&&cy<.68&&span<extent*.32&&group.points[0].componentMean>fine.high*1.1;
    let stableCount=0,outerCount=0;
    for(const p of group.points){const x=Math.floor(p.x),y=Math.floor(p.y);p.stable=!!stable[y*width+x];p.outer=p.alphaBoundary||Math.min(x-rowsMin[y],rowsMax[y]-x,y-colsMin[x],colsMax[x]-y)<=2;if(p.stable)stableCount++;if(p.outer)outerCount++;}
    const stableRatio=stableCount/group.points.length,outerRatio=outerCount/group.points.length;
    if(!focal&&stableRatio<.18&&outerRatio<.15&&group.points[0].componentMean<fine.high*1.65)continue;
    const central=photo?Math.max(.25,1-Math.hypot((cx-.5)*1.3,(cy-.38)*1.1)):1;
    const significance=(outerRatio*4+stableRatio*2+(focal?3:0)+Math.log2(group.points.length+1)*.25)*central;
    for(const p of group.points){p.priority=p.outer?1:focal?.95:p.stable?.85:.35;p.weight*=(p.outer?2.7:focal?2.4:p.stable?1.7:.65)*(photo?central*(focal?2:1):1);}
    ranked.push({...group,significance});
  }
  ranked.sort((a,b)=>b.significance-a.significance);
  // Do not let dozens of compression fragments or tiny decorative strokes
  // consume the budget. Retain the strongest connected parts first.
  let retained=ranked.slice(0,80),candidates=retained.flatMap(g=>g.points);
  if(!candidates.length)return {points:[],count:0,metrics:{lineLength:0,parts:0}};
  function budget(list,parts){
    const length=list.reduce((sum,p)=>sum+p.priority,0)*512/Math.max(width,height);
    const amount=Math.round((280+Math.max(0,length-1200)*(photo?.11:.15)+Math.min(parts,45)*(photo?7:10))/10)*10;
    return {count:Math.min(2000,Math.max(300,amount)),length};
  }
  let estimate=budget(candidates,retained.length);
  retained=retained.slice(0,Math.max(18,Math.floor((requestedCount||estimate.count)/9)));candidates=retained.flatMap(g=>g.points);estimate=budget(candidates,retained.length);
  const points=placePoints(data,width,height,requestedCount||estimate.count,candidates);
  return {points,count:points.length,metrics:{lineLength:Math.round(estimate.length),parts:retained.length}};
}

export function planShow(data,width,height,requestedCount=0){
  if(requestedCount&&(!Number.isInteger(requestedCount)||requestedCount>2000||requestedCount<1))throw new Error('Invalid drone count');
  const classification=classifyImage(data,width,height);
  if(classification.kind==='illustration'){const result=planLines(data,width,height,false,requestedCount);return {...result,metrics:{...result.metrics,kind:'illustration',surfaceCount:0}};}
  const image=simplifyPhoto(data,width,height),result=planLines(image.data,image.width,image.height,true,requestedCount);
  const target=requestedCount||result.count,lineBudget=Math.ceil(target*.8);
  const fill=surfacePoints(image.original,image.width,image.height,result.points.slice(0,lineBudget),Math.max(0,target-lineBudget));
  const selected=[...result.points.slice(0,lineBudget),...fill,...result.points.slice(lineBudget,lineBudget+Math.max(0,target-lineBudget-fill.length))];
  // Display original photo colors, never palette-center colors. Recheck alpha
  // at the original resolution after resizing and point normalization.
  const size=Math.max(width,height);
  const points=selected.map(p=>{
    const px=p.x*size+width/2,py=p.y*size+height/2,x=Math.max(0,Math.min(width-1,Math.floor(px))),y=Math.max(0,Math.min(height-1,Math.floor(py)));
    let best=-1,bx=x,by=y;
    for(let radius=0;radius<=4&&best<0;radius++)for(let dy=-radius;dy<=radius&&best<0;dy++)for(let dx=-radius;dx<=radius&&best<0;dx++){
      if(radius&&Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
      const i=(yy*width+xx)*4;if(data[i+3]){best=i;bx=xx;by=yy;break;}
    }
    if(best<0)return null;
    return {...p,x:p.x+(bx-x)/size,y:p.y+(by-y)/size,r:data[best],g:data[best+1],b:data[best+2]};
  }).filter(Boolean).slice(0,target);
  return {points,count:points.length,metrics:{...result.metrics,kind:'photo',surfaceCount:fill.length,analysisWidth:image.width,analysisHeight:image.height}};
}
