import { registeredMedia, registeredMediaPaths } from './asset/webMedia/mediaRegistry';
export const studioSourcePath=(id:string)=>{const match=/^source-(\d+)$/.exec(id);if(!match)throw Error('INVALID_SOURCE');const path=registeredMediaPaths()[Number(match[1])];if(!path||!registeredMedia(path))throw Error('INVALID_SOURCE');return path;};
const wait=(target:HTMLMediaElement,event:string,action:()=>void)=>new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener('error',bad);};const ok=()=>{done();resolve();};const bad=()=>{done();reject(Error('SOURCE_DECODE'));};const timer=setTimeout(bad,8000);target.addEventListener(event,ok,{once:true});target.addEventListener('error',bad,{once:true});action();});
function visual(draw:CanvasImageSource,w:number,h:number){const scale=Math.min(1,768/Math.max(w,h));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(draw,0,0,canvas.width,canvas.height);let url=canvas.toDataURL('image/jpeg',.8);if(url.length>180000)url=canvas.toDataURL('image/jpeg',.48);if(url.length>200000){const c=document.createElement('canvas');c.width=Math.round(canvas.width*.65);c.height=Math.round(canvas.height*.65);c.getContext('2d')!.drawImage(canvas,0,0,c.width,c.height);url=c.toDataURL('image/jpeg',.6);}return {mimeType:'image/jpeg',data:url.split(',')[1],width:canvas.width,height:canvas.height};}
export async function studioAISources(){
 const paths=registeredMediaPaths(),sources:any[]=[],visuals:any[]=[];
 for(let i=0;i<Math.min(paths.length,100);i++){
  const item=registeredMedia(paths[i]);if(!item)continue;const file=item.file,id='source-'+i;
  const source:any={id,name:item.name,mimeType:file.type,bytes:file.size,visualStatus:'not_applicable'};sources.push(source);
  if(visuals.length>=8){source.visualStatus='not_attached_budget';continue;}
  try{
   if(file.type.startsWith('image/')){const bitmap=await createImageBitmap(file);source.width=bitmap.width;source.height=bitmap.height;visuals.push({sourceId:id,...visual(bitmap,bitmap.width,bitmap.height)});bitmap.close();source.visualStatus='attached';}
   else if(file.type.startsWith('video/')){
    const el=document.createElement('video');el.muted=true;el.preload='auto';el.src=paths[i];
    try{await wait(el,'loadeddata',()=>el.load());source.width=el.videoWidth;source.height=el.videoHeight;source.durationSeconds=Number.isFinite(el.duration)?el.duration:0;
     const times=[Math.min(.1,source.durationSeconds/2),source.durationSeconds/2,Math.max(0,source.durationSeconds-.1)];
     for(const t of times){if(visuals.length>=8)break;if(Math.abs(el.currentTime-t)>.02)await wait(el,'seeked',()=>{el.currentTime=t;});visuals.push({sourceId:id,timeSeconds:Math.round(t*100)/100,...visual(el,el.videoWidth,el.videoHeight)});}source.visualStatus='attached_frames';
    }finally{el.pause();el.removeAttribute('src');el.load();}
   }else if(file.type.startsWith('audio/'))source.visualStatus='audio_metadata_only';
  }catch{source.visualStatus='decode_failed';}
 }
 return {sources,visuals,totalSources:paths.length,omittedSources:Math.max(0,paths.length-sources.length)};
}
