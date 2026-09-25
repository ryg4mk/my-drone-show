// One GPU point cloud, or one Canvas with shared pre-rendered light sprites.
const VERTEX=`
precision mediump float;
attribute vec2 aFrom; attribute vec2 aTo;
attribute vec3 aFromColor; attribute vec3 aToColor; attribute vec3 aExitTiming;
uniform vec2 uStage; uniform vec2 uOffset;
uniform float uUnit; uniform float uProgress; uniform float uPointSize;
uniform float uFlash; uniform float uMotion; uniform float uExitTime;
varying vec3 vColor; varying vec2 vTravel; varying float vExitAlpha;
void main(){
  float travel=uExitTime<0.0?uProgress:smoothstep(aExitTiming.x,2.65,uExitTime);
  vec2 p=mix(aFrom,aTo,travel)*uUnit+uOffset;
  gl_Position=vec4(p.x*2.0/uStage.x-1.0,1.0-p.y*2.0/uStage.y,0.0,1.0);
  gl_PointSize=uPointSize*(1.0+uFlash*.16+uMotion*.22);
  vColor=mix(aFromColor,aToColor,travel);
  vExitAlpha=uExitTime<0.0?1.0:1.0-smoothstep(aExitTiming.y,aExitTiming.z,uExitTime);
  vec2 delta=aTo-aFrom; vTravel=length(delta)>0.0001?normalize(vec2(delta.x,-delta.y)):vec2(1.0,0.0);
}`;
const FRAGMENT=`
precision mediump float;
varying vec3 vColor; varying vec2 vTravel; varying float vExitAlpha;
uniform float uAlpha; uniform float uFlash; uniform float uMotion; uniform float uTime; uniform float uGlow;
void main(){
  vec2 q=(gl_PointCoord-vec2(.5))*2.0;
  float r=length(q);
  float core=1.0-smoothstep(.06,.20,r);
  float halo=(1.0-smoothstep(.12,.84,r))*.22*uGlow;
  float outer=(1.0-smoothstep(.45,1.0,r))*.065*uGlow;
  float behind=dot(q,vTravel);
  float across=abs(q.x*vTravel.y-q.y*vTravel.x);
  float trail=uMotion*(1.0-smoothstep(-.90,-.05,behind))*(1.0-smoothstep(.08,.36,across))*.12;
  float twinkle=1.0+.035*sin(uTime*2.1+vColor.r*17.0+vColor.g*11.0);
  float alpha=min(1.0,(core+halo+outer+trail)*(1.0+uFlash*.38)*twinkle)*uAlpha*vExitAlpha;
  gl_FragColor=vec4(mix(vColor,vec3(1.0),core*.42),alpha);
}`;

function asFrame(points){
  const data=new Float32Array(points.length*5);
  for(let i=0;i<points.length;i++){const p=points[i],j=i*5;data[j]=p.x;data[j+1]=p.y;data[j+2]=p.r/255;data[j+3]=p.g/255;data[j+4]=p.b/255;}
  return data;
}
function randomFrame(reference){
  const data=new Float32Array(reference.length);
  for(let i=0;i<data.length;i+=5){data[i]=(Math.random()-.5)*1.5;data[i+1]=(Math.random()-.5)*1.5;data[i+2]=reference[i+2];data[i+3]=reference[i+3];data[i+4]=reference[i+4];}
  return data;
}
function variance(index,salt){let n=Math.imul(index+1,0x45d9f3b)^salt;n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967295;}
function departurePlan(reference){
  const target=new Float32Array(reference.length),timing=new Float32Array(reference.length/5*3);let centerX=0,centerY=0;
  const count=reference.length/5;for(let i=0;i<reference.length;i+=5){centerX+=reference[i];centerY+=reference[i+1];}centerX/=count||1;centerY/=count||1;
  for(let i=0;i<count;i++){
    const j=i*5,k=i*3,dx=reference[j]-centerX,dy=reference[j+1]-centerY,radius=Math.hypot(dx,dy),outer=Math.min(1,radius/.65);
    const base=radius<.025?variance(i,0x1ac7)*Math.PI*2:Math.atan2(dy,dx),angle=base+(variance(i,0x9a11)-.5)*.20;
    const distance=.11+.07*outer+(variance(i,0xb314)-.5)*.025;
    target[j]=reference[j]+Math.cos(angle)*distance;target[j+1]=reference[j+1]+Math.sin(angle)*distance;
    target[j+2]=reference[j+2];target[j+3]=reference[j+3];target[j+4]=reference[j+4];
    timing[k]=.3+variance(i,0x73ce)*.14;
    timing[k+1]=1.2+variance(i,0x39bf)*.58+outer*.10;
    timing[k+2]=2.45+variance(i,0xfee3)*.50-outer*.10;
  }
  return {target,timing};
}
function smoothstep(a,b,value){const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);}

function webglRenderer(canvas,gl){
  const shader=(type,source)=>{const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(item));return item;};
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [name,size,offset] of [['aFrom',2,0],['aTo',2,8],['aFromColor',3,16],['aToColor',3,28],['aExitTiming',3,40]]){const location=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,52,offset);}
  const uniforms=Object.fromEntries(['uStage','uOffset','uUnit','uProgress','uPointSize','uAlpha','uFlash','uMotion','uTime','uGlow','uExitTime'].map(name=>[name,gl.getUniformLocation(program,name)]));
  gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE,gl.ONE,gl.ONE);gl.clearColor(0,0,0,0);
  let frames=[],scattered=null,data=new Float32Array(0),count=0;
  function segment(from,to,timing){
    if(!count)return;
    for(let i=0;i<count;i++){const j=i*13,k=i*5,h=i*3;data[j]=from[k];data[j+1]=from[k+1];data[j+2]=to[k];data[j+3]=to[k+1];data[j+4]=from[k+2];data[j+5]=from[k+3];data[j+6]=from[k+4];data[j+7]=to[k+2];data[j+8]=to[k+3];data[j+9]=to[k+4];data[j+10]=timing?.[h]??.3;data[j+11]=timing?.[h+1]??1.2;data[j+12]=timing?.[h+2]??3;}
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);
  }
  return {kind:'webgl',
    setFrames(shapes){frames=shapes.map(asFrame);count=shapes[0]?.length||0;data=new Float32Array(count*13);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);scattered=null;},
    scatter(){if(!count)return;scattered=randomFrame(frames[0]);segment(scattered,frames[0]);},
    setSegment(from,to){segment(frames[from],frames[to]);},
    depart(index){const plan=departurePlan(frames[index]);segment(frames[index],plan.target,plan.timing);},
    resize(pixelWidth,pixelHeight){gl.viewport(0,0,pixelWidth,pixelHeight);},
    clear(){gl.clear(gl.COLOR_BUFFER_BIT);},
    draw(progress,width,height,offsetX,offsetY,unit,pointSize,effects={}){
      gl.clear(gl.COLOR_BUFFER_BIT);if(!count)return;gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.uniform2f(uniforms.uStage,width,height);gl.uniform2f(uniforms.uOffset,width/2+offsetX,height/2+offsetY);
      gl.uniform1f(uniforms.uUnit,unit);gl.uniform1f(uniforms.uProgress,progress);gl.uniform1f(uniforms.uPointSize,pointSize*canvas.width/width);
      gl.uniform1f(uniforms.uAlpha,effects.alpha??1);gl.uniform1f(uniforms.uFlash,effects.flash||0);gl.uniform1f(uniforms.uMotion,effects.motion||0);gl.uniform1f(uniforms.uTime,effects.time||0);gl.uniform1f(uniforms.uGlow,effects.glow??1);gl.uniform1f(uniforms.uExitTime,effects.exitTime??-1);
      gl.drawArrays(gl.POINTS,0,count);
    },
    get count(){return count;},get cacheSize(){return 0;}
  };
}

function canvasRenderer(canvas){
  const ctx=canvas.getContext('2d'),cache=new Map();
  let frames=[],from=null,to=null,count=0,exitTiming=null;
  const quantize=value=>Math.min(255,Math.round(value/64)*64);
  function sprite(r,g,b,glow){const tier=glow<.6?2:glow<.8?1:0,colorKey=(quantize(r)<<16)|(quantize(g)<<8)|quantize(b),key=colorKey*4+tier;if(cache.has(key))return cache.get(key);
    const el=document.createElement('canvas');el.width=el.height=40;const c=el.getContext('2d'),gradient=c.createRadialGradient(20,20,0,20,20,20),rgb=`${(colorKey>>16)&255},${(colorKey>>8)&255},${colorKey&255}`;
    const light=tier===2?.52:tier===1?.72:1;
    gradient.addColorStop(0,`rgba(${rgb},1)`);gradient.addColorStop(.12,'rgba(255,255,255,.92)');gradient.addColorStop(.28,`rgba(${rgb},${(.27*light).toFixed(3)})`);gradient.addColorStop(.7,`rgba(${rgb},${(.05*light).toFixed(3)})`);gradient.addColorStop(1,`rgba(${rgb},0)`);c.fillStyle=gradient;c.fillRect(0,0,40,40);cache.set(key,el);return el;}
  function prepare(points,glow){const coordinates=asFrame(points),sprites=new Array(points.length);for(let i=0;i<points.length;i++)sprites[i]=sprite(points[i].r,points[i].g,points[i].b,glow);return {coordinates,sprites};}
  function random(reference){return {coordinates:randomFrame(reference.coordinates),sprites:reference.sprites};}
  return {kind:'canvas2d',
    setFrames(shapes){count=shapes[0]?.length||0;const glow=count>=1900?.52:count>=1400?.72:1;frames=shapes.map(points=>prepare(points,glow));from=to=null;exitTiming=null;},
    scatter(){if(!count)return;from=random(frames[0]);to=frames[0];exitTiming=null;},
    setSegment(a,b){from=frames[a];to=frames[b];exitTiming=null;},
    depart(index){from=frames[index];const plan=departurePlan(from.coordinates);to={coordinates:plan.target,sprites:from.sprites};exitTiming=plan.timing;},
    resize(_pixelWidth,_pixelHeight,dpr){ctx.setTransform(dpr,0,0,dpr,0,0);},
    clear(){ctx.clearRect(0,0,canvas.width,canvas.height);},
    draw(progress,width,height,offsetX,offsetY,unit,pointSize,effects={}){
      ctx.clearRect(0,0,width,height);if(!from||!to)return;
      ctx.globalCompositeOperation='lighter';ctx.globalAlpha=effects.alpha??1;
      const exitTime=effects.exitTime??-1,exiting=exitTime>=0,half=pointSize/2,cx=width/2+offsetX,cy=height/2+offsetY;
      for(let i=0;i<count;i++){const j=i*5,k=i*3,travel=exiting?smoothstep(exitTiming[k],2.65,exitTime):progress,alpha=exiting?1-smoothstep(exitTiming[k+1],exitTiming[k+2],exitTime):effects.alpha??1;
        if(alpha<=.001)continue;const x=cx+(from.coordinates[j]*(1-travel)+to.coordinates[j]*travel)*unit,y=cy+(from.coordinates[j+1]*(1-travel)+to.coordinates[j+1]*travel)*unit;ctx.globalAlpha=alpha;
        if(effects.motion>.5){const past=Math.max(0,progress-.025),px=cx+(from.coordinates[j]*(1-past)+to.coordinates[j]*past)*unit,py=cy+(from.coordinates[j+1]*(1-past)+to.coordinates[j+1]*past)*unit;ctx.globalAlpha=(effects.alpha??1)*.10;ctx.drawImage(to.sprites[i],px-half,py-half,pointSize,pointSize);ctx.globalAlpha=effects.alpha??1;}
        const size=pointSize*(1+(effects.flash||0)*.16);ctx.drawImage(travel<.5?from.sprites[i]:to.sprites[i],x-size/2,y-size/2,size,size);
      }
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    },get count(){return count;},get cacheSize(){return cache.size;}
  };
}
export function createRenderer(canvas){const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'low-power'});return gl?.createShader?webglRenderer(canvas,gl):canvasRenderer(canvas);}
