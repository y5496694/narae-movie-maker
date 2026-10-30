import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {serveMcp} from './mcp.mjs';

async function exchange(messages,runJob) {
  const input=new PassThrough(),output=new PassThrough();
  let received='';output.on('data',chunk=>received+=chunk);
  const serving=serveMcp({runJob,input,output});
  input.end(messages.map(message=>typeof message==='string'?message:JSON.stringify(message)).join('\n')+'\n');
  await serving;
  return received.trim().split('\n').map(line=>JSON.parse(line));
}
const request=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
test('stdio initialize, notification and discovery keep protocol output clean',async()=>{
  const result=await exchange([request(1,'initialize',{protocolVersion:'2025-06-18'}),{jsonrpc:'2.0',method:'notifications/initialized'},request(2,'tools/list')],()=>{throw Error('unexpected engine launch');});
  assert.equal(result.length,2);
  assert.equal(result[0].result.serverInfo.name,'narae-movie-maker');
  assert.equal(result[1].result.tools.length,2);
});
test('job calls are serialized and forward recipes without a GUI',async()=>{
  let running=0,max=0;const calls=[];
  const result=await exchange([request(1,'tools/call',{name:'narae_run_job',arguments:{job:{steps:[{tool:'add_text',args:{text:'한글'}}]}}}),request(2,'tools/call',{name:'narae_run_job',arguments:{job:{listTools:true}}})],async(job)=>{
    running++;max=Math.max(max,running);calls.push(job);
    await new Promise(resolve=>setTimeout(resolve,3));running--;return {ok:true};
  });
  assert.equal(max,1);assert.equal(calls[0].steps[0].args.text,'한글');
  assert.ok(result.every(item=>item.result.isError===false));
});
test('engine failures, unknown tools and malformed JSON return usable errors',async()=>{
  const result=await exchange(['{bad',request(1,'tools/call',{name:'narae_run_job',arguments:{job:{}}}),request(2,'unknown')],async()=>{throw Error('fixture failed');});
  assert.equal(result[0].error.code,-32700);
  assert.equal(result[1].result.isError,true);
  assert.match(result[1].result.content[0].text,/fixture failed/);
  assert.equal(result[2].error.code,-32601);
});
