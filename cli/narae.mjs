#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2);
const help=`나래 무비메이커 CLI 1.0.0

  narae new PROJECT.nmm --width 1080 --height 1920 --fps 30 --seconds 30
  narae inspect PROJECT.nmm
  narae edit PROJECT.nmm TOOL @arguments.json [--output OTHER.nmm]
  narae add PROJECT.nmm MEDIA --start 0 --seconds 5
  narae title PROJECT.nmm "한국어 제목" --start 0 --seconds 3
  narae render PROJECT.nmm VIDEO.mp4 [--settings settings.json] [--overwrite]
  narae run recipe.json [--result report.json]
  narae tools [--names] [--describe TOOL]
  narae capabilities
  narae mcp
  narae record-screen|record-camera|record-audio OUTPUT --seconds N [--dry-run]
  narae devices
  narae config set KEY VALUE
  narae config path
  narae doctor

CLI는 작업마다 자체 렌더 엔진을 창 없이 실행하고 종료합니다.
CartCut, 나래 GUI 설치·실행, 별도의 Node.js 설치가 필요하지 않습니다.
프로젝트는 .nmm 및 호환 .ngt 형식이며 도구 JSON의 시간 단위는 밀리초입니다.
레시피에서 {"$ref":"media.created.0"}으로 앞 단계 결과를 참조할 수 있습니다.
mcp 명령은 독립 실행 가능한 표준 입출력 MCP 서버를 시작합니다.
`;
function takeOption(args,name,fallback) {
  const i=args.indexOf(name);
  if(i<0) return fallback;
  if(i+1>=args.length) throw new Error(`Missing value for ${name}`);
  const value=args[i+1];args.splice(i,2);return value;
}
function flag(args,name) {const i=args.indexOf(name);if(i<0)return false;args.splice(i,1);return true;}
function number(args,name,fallback) {const n=Number(takeOption(args,name,fallback));if(!Number.isFinite(n))throw new Error(`Invalid number for ${name}`);return n;}
function readJson(file) {return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function jsonArgument(value) {return value?.startsWith('@')?readJson(path.resolve(value.slice(1))):JSON.parse(value||'{}');}
function print(value) {console.log(JSON.stringify(value,null,2));}
function settingsRoot() {
  return process.env.NARAE_CONFIG_HOME || path.join(process.env.APPDATA || path.join(os.homedir(),'.config'),'narae-movie-maker-cli');
}
function findEngine() {
  if(process.env.NARAE_ENGINE) return {exe:path.resolve(process.env.NARAE_ENGINE),args:[],cwd:path.dirname(path.resolve(process.env.NARAE_ENGINE)),packaged:true};
  for(const candidate of [path.join(here,'..','runtime','narae-movie-maker.exe'),path.join(here,'..','runtime','narae-engine.exe'),path.join(here,'..','runtime','Narae Movie Maker.app','Contents','MacOS','Narae Movie Maker'),path.join(here,'..','runtime','narae-movie-maker')]) {
    if(fs.existsSync(candidate)) return {exe:candidate,args:[],cwd:path.dirname(candidate),packaged:true};
  }
  const root=path.resolve(here,'..');
  const electron=path.join(root,'node_modules','electron','dist',process.platform==='win32'?'electron.exe':'electron');
  if(fs.existsSync(electron)&&fs.existsSync(path.join(root,'main','naraeBootstrap.js'))) return {exe:electron,args:[root],cwd:root,packaged:false};
  throw new Error('The bundled render engine is missing. Extract the complete Narae CLI package, including runtime/.');
}
function ffmpegPath(engine) {
  return engine.packaged?path.join(engine.cwd,'resources','bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'):path.join(engine.cwd,'bin',`${process.platform}-${process.arch}`,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
}
function normalizeJob(input,base) {
  const job=structuredClone(input);
  for(const key of ['project','saveProject']) if(job[key]) job[key]=path.resolve(base,job[key]);
  if(job.export?.path) job.export.path=path.resolve(base,job.export.path);
  for(const step of job.steps||[]) {
    if(['add_media'].includes(step.tool)) for(const item of step.args?.items||[]) {
      if(typeof item.path==='string'&&!/^(?:https?|file):/i.test(item.path)) item.path=path.resolve(base,item.path);
    }
  }
  return job;
}
async function runJob(input,{base=process.cwd(),reportPath}={}) {
  const engine=findEngine();
  const tempRoot=path.join(os.tmpdir(),'narae-movie-maker-runs');
  await fsp.mkdir(tempRoot,{recursive:true});
  const runDir=await fsp.mkdtemp(path.join(tempRoot,'job-'));
  const normalized=normalizeJob(input,base);
  const anchor=normalized.saveProject||normalized.project||normalized.export?.path;
  const profileId=anchor?createHash('sha256').update(path.resolve(anchor)).digest('hex').slice(0,24):undefined;
  const profilePath=profileId?path.join(settingsRoot(),'profiles',profileId):path.join(runDir,'profile');
  await fsp.mkdir(profilePath,{recursive:true});
  const settingsFile=path.join(settingsRoot(),'config.json');
  const settings=fs.existsSync(settingsFile)?readJson(settingsFile):{};
  const profileConfig=path.join(profilePath,'config.json');
  const previous=fs.existsSync(profileConfig)?readJson(profileConfig):{};
  await fsp.writeFile(profileConfig,JSON.stringify({...previous,LANG:'ko',...settings,ONBOARDING_COMPLETED:true,TUTORIAL_COMPLETED:true}));
  const resultPath=path.join(runDir,'result.json');
  const job={version:1,...normalized,profilePath,resultPath};
  const jobPath=path.join(runDir,'job.json');
  await fsp.writeFile(jobPath,JSON.stringify(job));
  const env={...process.env,NARAE_JOB_FILE:jobPath,NARAE_HEADLESS:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  const logFile=path.join(runDir,'engine.log');
  const logs=fs.openSync(logFile,'w');
  let result;
  try {
    const child=spawn(engine.exe,engine.args,{cwd:engine.cwd,env,windowsHide:true,stdio:['ignore',logs,logs]});
    let timer;
    const code=await new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',code=>{clearTimeout(timer);resolve(code);});
      timer=setTimeout(()=>{child.kill();reject(new Error(`Engine job timed out. Logs: ${logFile}`));},input.timeoutMs||3700000);
    });
    fs.closeSync(logs);
    if(!fs.existsSync(resultPath)) {
      const tail=fs.readFileSync(logFile,'utf8').slice(-6000);
      throw new Error(`The render engine exited (${code}) before returning a result\n${tail}`);
    }
    result=readJson(resultPath);
    if(reportPath) {await fsp.mkdir(path.dirname(reportPath),{recursive:true});await fsp.writeFile(reportPath,JSON.stringify(result,null,2));}
    if(!result.ok) throw new Error(result.error||'The engine job failed');
    return result;
  } catch(error) {
    if(!result) {try{fs.closeSync(logs);}catch{}}
    if(process.env.NARAE_KEEP_RUNS==='1') console.error(`Kept job diagnostics: ${runDir}`);
    throw error;
  } finally {
    if(process.env.NARAE_KEEP_RUNS!=='1') {
      const resolved=path.resolve(runDir),parent=path.resolve(tempRoot)+path.sep;
      if(resolved.startsWith(parent)) await fsp.rm(resolved,{recursive:true,force:true}).catch(()=>{});
    }
  }
}

async function main() {
  const command=argv.shift();
  if(!command||['help','--help','-h'].includes(command)){console.log(help);return;}
  const report=takeOption(argv,'--result');
  const reportPath=report?path.resolve(report):undefined;
  if(command==='config') {
    const file=path.join(settingsRoot(),'config.json');
    if(argv[0]==='path'){console.log(file);return;}
    if(argv[0]!=='set'||!argv[1]||argv[2]==null)throw new Error('Usage: narae config set KEY VALUE');
    const config=fs.existsSync(file)?readJson(file):{};
    let value=argv[2];try{value=JSON.parse(value);}catch{}
    config[argv[1]]=value;
    await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,JSON.stringify(config,null,2));
    print({ok:true,path:file,key:argv[1]});return;
  }
  if(command==='doctor') {
    const engine=findEngine();print({ok:true,engine:engine.exe,packaged:engine.packaged,ffmpeg:ffmpegPath(engine),ffmpegPresent:fs.existsSync(ffmpegPath(engine)),guiRequired:false,cartcutRequired:false,nodeInstallationRequired:false});return;
  }
  if(command==='mcp') {
    const {serveMcp}=await import('./mcp.mjs');
    await serveMcp({runJob});return;
  }
  if(['record-screen','record-camera','record-audio','devices'].includes(command)) {
    const {runRecordingCommand}=await import('./record.mjs');
    const result=await runRecordingCommand(command,argv,{ffmpegPath:ffmpegPath(findEngine())});
    print(result);if(result.cancelled)process.exitCode=130;return;
  }
  let job;
  let base=process.cwd();
  if(command==='run') {
    if(!argv[0])throw new Error('A recipe JSON path is required');
    const file=path.resolve(argv[0]);base=path.dirname(file);job=readJson(file);
  } else if(command==='tools') {
    const result=await runJob({listTools:true},{reportPath});
    const describe=takeOption(argv,'--describe');
    print(describe?result.tools.find(tool=>tool.name===describe):flag(argv,'--names')?result.tools.map(tool=>tool.name):result.tools);return;
  } else if(command==='capabilities') job={steps:[{tool:'narae_capabilities'}]};
  else if(command==='new') {
    if(!argv[0])throw new Error('A project output path is required');
    const output=path.resolve(argv.shift());
    job={configure:{width:number(argv,'--width',1920),height:number(argv,'--height',1080),fps:number(argv,'--fps',30),durationMs:number(argv,'--seconds',10)*1000,backgroundColor:takeOption(argv,'--background','#000000')},saveProject:output,overwrite:flag(argv,'--overwrite')};
  } else if(command==='inspect') {
    if(!argv[0])throw new Error('A project path is required');
    job={project:path.resolve(argv[0]),steps:[{tool:'get_project_overview'},{tool:'list_clips'}]};
  } else if(command==='edit') {
    const [project,tool,args]=argv;
    if(!project||!tool)throw new Error('Usage: narae edit PROJECT TOOL @arguments.json');
    const output=takeOption(argv,'--output',project);
    job={project:path.resolve(project),steps:[{tool,args:jsonArgument(args)}],saveProject:path.resolve(output),overwrite:path.resolve(output)===path.resolve(project)||flag(argv,'--overwrite')};
  } else if(command==='add'||command==='title') {
    const project=path.resolve(argv.shift()||'');const value=argv.shift();
    if(!value)throw new Error('A media path or title text is required');
    const startMs=number(argv,'--start',0)*1000,durationMs=number(argv,'--seconds',5)*1000;
    const tool=command==='add'?'add_media':'add_text';
    const args=command==='add'?{items:[{path:path.resolve(value),startMs,durationMs}]}:{text:value,startMs,durationMs,style:{fontsize:number(argv,'--font-size',72),textcolor:takeOption(argv,'--color','#ffffff')}};
    job={project,steps:[{tool,args}],saveProject:project,overwrite:true};
  } else if(command==='render') {
    if(!argv[0]||!argv[1])throw new Error('Usage: narae render PROJECT OUTPUT [--settings settings.json]');
    const settings=takeOption(argv,'--settings');
    job={project:path.resolve(argv[0]),export:{path:path.resolve(argv[1]),settings:settings?readJson(path.resolve(settings)):undefined,overwrite:flag(argv,'--overwrite')}};
  } else throw new Error(`Unknown command ${command}\n${help}`);
  print(await runJob(job,{base,reportPath}));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
