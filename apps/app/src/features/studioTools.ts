import { getCommand } from './agent/registry';
import './agent/bridge';
const tools: any[] = require('./studio-generated/tools.json');
import { validators } from './studio-generated/validation';
import { ensurePresetsLoaded } from './fx/presetRegistry';
import { useTimelineStore } from '../states/timelineStore';
import { renderOptionStore } from '../states/renderOptionStore';
import { registerPickedFile, registeredMedia } from './asset/webMedia/mediaRegistry';

// Browser AI only receives editing operations, never native calls or executable programs.
const allowed = new Set(['get_project_overview','list_clips','get_clip','add_text','add_subtitles','update_clip','split_clip','trim_clip','move_clips','delete_clips','duplicate_clips','set_clip_speed','add_track','move_track','set_track_hidden','add_shape','set_crop','set_mirror','rotate_clips','set_color_adjustments','set_clip_decoration','apply_animation_preset','set_animation','add_keyframes','remove_keyframes','configure_project','undo','redo']);
export function createStudioTools(){
 let revision=0,tail:Promise<any>=Promise.resolve();
 useTimelineStore.subscribe((s,p)=>{if(s.timeline!==p.timeline||s.tracks!==p.tracks||s.activeTimelineId!==p.activeTimelineId)revision++;});
 renderOptionStore.subscribe((s,p)=>{if(s.options!==p.options)revision++;});
 const supported=()=>tools.filter(t=>allowed.has(t.name)&&!!getCommand(t.name));
 const queue=(run:()=>Promise<any>)=>{const pending=tail.then(run,run);tail=pending.catch(()=>{});return pending;};
 return {
  tools:()=>supported(),
  revision:()=>revision,
  cursor:()=>({ms:useTimelineStore.getState().cursor,timeline:useTimelineStore.getState().activeTimelineId}),
  async command(name:string,args:any={},expectedRevision?:number){
   return queue(async()=>{
    if(expectedRevision!=null&&expectedRevision!==revision)throw Error('EDITOR_CHANGED');
    if(!supported().some(t=>t.name===name))throw Error('UNSUPPORTED_TOOL');
    if(JSON.stringify(args).length>128*1024)throw Error('COMMAND_TOO_LARGE');
    const check=validators[name];if(!check(args))throw Error('INVALID_ARGUMENTS');
    await ensurePresetsLoaded();
    if(expectedRevision!=null&&expectedRevision!==revision)throw Error('EDITOR_CHANGED');
    const result:any=await getCommand(name)!(structuredClone(args));
    if(result?.ok===false)throw Error('EDIT_DECLINED');
    return {revision,result};
   });
  },
  async importMedia(bytes:ArrayBuffer,name:string,type:string,startMs=0,durationMs?:number,expectedRevision?:number){
   return queue(async()=>{
    if(expectedRevision!=null&&expectedRevision!==revision)throw Error('EDITOR_CHANGED');
    if(bytes.byteLength>512*1024*1024||!Number.isFinite(startMs)||startMs<0)throw Error('INVALID_MEDIA');
    const path=registerPickedFile(new File([bytes],name,{type}));
    const result:any=await getCommand('add_media')!({items:[{path,startMs,...(durationMs!=null?{durationMs}:{})}],sequential:false});
    if(result?.ok===false||result?.skipped?.length)throw Error('MEDIA_IMPORT_FAILED');
    return {revision,result,path};
   });
  },
  seek(ms:number){if(!Number.isFinite(ms)||ms<0)throw Error('INVALID_TIME');useTimelineStore.getState().setCursor(ms);},
 };
}
