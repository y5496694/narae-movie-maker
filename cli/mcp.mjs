import readline from 'node:readline';
import path from 'node:path';

export const MCP_TOOLS=[
  {name:'narae_run_job',description:'나래 독립 영상 편집 엔진에서 프로젝트 생성·편집·저장·렌더링 레시피를 실행합니다. GUI와 CartCut 없이 실행되며 108개 편집 도구를 steps 안에서 사용할 수 있습니다. 먼저 narae_describe_tools로 스키마를 확인하세요.',inputSchema:{type:'object',properties:{job:{type:'object',description:'version:1, project?, configure?, steps:[{id?,tool,args}], saveProject?, overwrite?, export?:{path,overwrite,settings}'},basePath:{type:'string',description:'레시피 안 상대 경로의 기준 절대 폴더'},reportPath:{type:'string',description:'결과 JSON을 저장할 절대 경로(선택)'}},required:['job'],additionalProperties:false}},
  {name:'narae_describe_tools',description:'원본 편집 기능과 추가 기능을 포함하는 실제 엔진 도구의 JSON 스키마를 조회합니다. name 생략 시 이름·설명 목록, allSchemas:true이면 전체 스키마를 반환합니다.',inputSchema:{type:'object',properties:{name:{type:'string'},allSchemas:{type:'boolean'}},additionalProperties:false}},
];
MCP_TOOLS[0].annotations={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true};
MCP_TOOLS[1].annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};

export async function serveMcp({runJob,input=process.stdin,output=process.stdout}) {
  const lines=readline.createInterface({input,crlfDelay:Infinity});
  const send=message=>output.write(JSON.stringify(message)+'\n');
  let descriptions;
  const getDescriptions=async()=>descriptions??=(await runJob({listTools:true})).tools;
  let queue=Promise.resolve();
  async function dispatch(request) {
    if(request.id==null)return;
    const response={jsonrpc:'2.0',id:request.id};
    try {
      let result;
      if(request.method==='initialize') {
        const version=request.params?.protocolVersion;
        result={protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(version)?version:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'narae-movie-maker',version:'1.0.0'},instructions:'영상 편집은 narae_run_job의 steps로 실행합니다. 시간 단위는 밀리초이고 저장 및 내보내기 경로를 명시하세요. GUI는 필요하지 않습니다.'};
      } else if(request.method==='ping') result={};
      else if(request.method==='tools/list') result={tools:MCP_TOOLS};
      else if(request.method==='tools/call') {
        const {name,arguments:args={}}=request.params??{};
        try {
          let value;
          if(name==='narae_describe_tools') {
            const tools=await getDescriptions();
            value=args.name?tools.find(tool=>tool.name===args.name):args.allSchemas?tools:tools.map(({name,description})=>({name,description}));
            if(!value)throw new Error(`Unknown engine tool: ${args.name}`);
          } else if(name==='narae_run_job') {
            if(!args.job||typeof args.job!=='object'||Array.isArray(args.job))throw new Error('job must be an object');
            if(args.basePath&&!path.isAbsolute(args.basePath))throw new Error('basePath must be absolute');
            if(args.reportPath&&!path.isAbsolute(args.reportPath))throw new Error('reportPath must be absolute');
            value=await runJob(args.job,{base:args.basePath||process.cwd(),reportPath:args.reportPath});
          } else throw new Error(`Unknown MCP tool: ${name}`);
          result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};
        } catch(error) {result={content:[{type:'text',text:error.message||String(error)}],isError:true};}
      } else {send({...response,error:{code:-32601,message:'Method not found'}});return;}
      send({...response,result});
    } catch(error) {send({...response,error:{code:-32603,message:error.message||String(error)}});}
  }
  for await(const line of lines) {
    if(!line.trim())continue;
    let request;
    try {request=JSON.parse(line);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});continue;}
    if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string') {send({jsonrpc:'2.0',id:request?.id??null,error:{code:-32600,message:'Invalid Request'}});continue;}
    queue=queue.then(()=>dispatch(request));
  }
  await queue;
}
