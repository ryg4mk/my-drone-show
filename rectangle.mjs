export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function rectFromPoints(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};}
export function moveRect(rect,dx,dy){return {...rect,x:clamp(rect.x+dx,0,1-rect.width),y:clamp(rect.y+dy,0,1-rect.height)};}
export function resizeRect(rect,corner,point,minWidth=.01,minHeight=.01){
  let left=rect.x,right=rect.x+rect.width,top=rect.y,bottom=rect.y+rect.height;
  if(corner.includes('w'))left=clamp(point.x,0,right-minWidth);else right=clamp(point.x,left+minWidth,1);
  if(corner.includes('n'))top=clamp(point.y,0,bottom-minHeight);else bottom=clamp(point.y,top+minHeight,1);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function pixelBounds(rect,width,height){
  const x=clamp(Math.floor(rect.x*width),0,width-1),y=clamp(Math.floor(rect.y*height),0,height-1);
  const right=clamp(Math.ceil((rect.x+rect.width)*width),x+1,width),bottom=clamp(Math.ceil((rect.y+rect.height)*height),y+1,height);
  return {x,y,width:right-x,height:bottom-y};
}
