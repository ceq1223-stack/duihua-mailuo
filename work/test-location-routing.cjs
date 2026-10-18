const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),Atlas=require('../outputs/topic-atlas-extension/core.js');
const source=fs.readFileSync('outputs/topic-atlas-extension/panel.js','utf8');
const code=source.slice(source.indexOf('async function sendLocate('),source.indexOf('async function locate(id)'));
const record={url:'https://chatgpt.com/c/record',key:'ChatGPT:https://chatgpt.com/c/record'},payload={type:'locate',key:record.key,nativeId:'message-id'};
async function run(existing){
 const calls=[],context={Atlas,setTimeout,activeTab:async()=>({id:1,url:'https://chatgpt.com/c/other'}),toPage:()=>{throw Error('wrong active page')},chrome:{tabs:{query:async()=>existing?[{id:2,url:record.url,windowId:1}]:[],update:async(id)=>{calls.push(['focus',id])},create:async details=>{calls.push(['open',details.url]);return {id:3}},sendMessage:async(id,m)=>{if(m.type==='status')return {conversation:{key:record.key}};calls.push(['locate',id,m.nativeId]);return {ok:true}}},windows:{update:async()=>{}}}};
 vm.runInNewContext(code,context);const r=await context.sendLocate(record,payload);assert(r.ok);
 assert.deepEqual(calls[0],existing?['focus',2]:['open',record.url]);assert.deepEqual(calls[1],['locate',existing?2:3,'message-id']);
 await assert.rejects(context.sendLocate({url:'https://evil.example/c/record',key:record.key},payload),/可验证/);
}
(async()=>{await run(true);console.log('PASS archive locate focuses an existing matching conversation tab');await run(false);console.log('PASS archive locate opens the validated original URL when no matching tab exists');console.log('PASS mismatched or unsupported stored URL is rejected')})().catch(e=>{console.error(e);process.exitCode=1});
