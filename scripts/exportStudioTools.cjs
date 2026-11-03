// Export the existing MCP schemas without loading Electron. Never runs tool handlers.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {z}=require('zod'),{zodToJsonSchema}=require('zod-to-json-schema');
const Ajv=require('ajv'),standalone=require('ajv/dist/standalone').default;
const old=Module._load;
Module._load=function(name,parent,...rest){
 if(parent?.filename.includes(path.join('electron','mcp'))&&name==='../bridge')return {requestEditor(){throw Error('build-time only')}};
 if(parent?.filename.includes(path.join('electron','mcp'))&&name==='../contactSheet')return {MAX_FRAMES:12,CONTACT_SHEET_TIMEOUT_MS:60000,nextIndex:()=>0,sampleTimes:()=>[],writeSheet:()=>{}};
 return old.call(this,name,parent,...rest);
};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const ajv=new Ajv({code:{source:true,esm:true},strict:false,allErrors:true});const tools=[];
require('../electron/mcp/tools.ts').registerToolsWith((name,cfg)=>{
 const inputSchema=zodToJsonSchema(z.object(cfg.inputSchema||{}),{$refStrategy:'none'});delete inputSchema.$schema;
 ajv.addSchema(inputSchema,name);tools.push({name,description:cfg.description||cfg.title||name,inputSchema,annotations:cfg.annotations||{}});
});
const dir=path.resolve(__dirname,'../apps/app/src/features/studio-generated');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'tools.json'),JSON.stringify(tools));
fs.writeFileSync(path.join(dir,'validate.js'),standalone(ajv,Object.fromEntries(tools.map((t,i)=>['v'+i,t.name]))));
fs.writeFileSync(path.join(dir,'validation.ts'),'// Generated from the real MCP input schemas.\nimport * as v from "./validate";\nexport const validators: Record<string,any> = '+JSON.stringify(Object.fromEntries(tools.map((t,i)=>[t.name,'v'+i]))).replace(/:"(v\d+)"/g,':v.$1')+';\n');
console.log('EXPORTED_SCHEMAS',tools.length);
