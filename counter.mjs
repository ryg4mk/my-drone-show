// One shared page-view counter. No image, file name, user ID or referrer.
// No third-party script is allowed access to the image editor.
// This copy is also published from the /my-drone-show/ GitHub Pages project path.
const publishedHost=typeof location!=='undefined'&&(location.hostname==='my-drone-show.ioyemelong.chatgpt.site'||
  (location.hostname==='ryg4mk.github.io'&&location.pathname.startsWith('/my-drone-show/')));
export async function updateCounter(element,request=fetch,live=publishedHost){
  element.hidden=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
  try{
    const url='https://countapi.mileshilliard.com/api/v1/'+(live?'hit/':'get/')+'my_drone_show_6aa90fd35c248191b8780602299d6b0b';
    const response=await request(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
    if(!response.ok)return;
    const result=await response.json(),raw=result.value;
    const count=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):NaN;
    if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0)return;
    element.textContent=`アクセス数：${count.toLocaleString('ja-JP')}`;element.hidden=false;
  }catch{/* Counter failure must never affect the show. */}finally{clearTimeout(timer);}
}
if(typeof document!=='undefined'){const element=document.getElementById('visitCount');if(element)void updateCounter(element);}
