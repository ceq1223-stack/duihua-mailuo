const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../outputs/topic-atlas-extension/core.js');
const {page,flush}=require('./test-unified-settings.cjs');
const dir='outputs/topic-atlas-extension/';
const fixture={title:'PRIVATE_TITLE',current_node:'final',mapping:{
 root:{parent:null,children:['user'],message:null},
 user:{parent:'root',children:['analysis'],message:{id:'PRIVATE_ID',author:{role:'user'},content:{content_type:'text',parts:['PRIVATE_USER_TEXT']}}},
 analysis:{parent:'user',children:['code'],message:{author:{role:'assistant'},channel:'analysis',recipient:'all',content:{content_type:'thoughts',parts:['PRIVATE_THOUGHTS']},metadata:{is_internal:true}}},
 code:{parent:'analysis',children:['output'],message:{author:{role:'assistant'},recipient:'functions.exec_command',content:{content_type:'code',language:'bash',text:'PRIVATE_COMMAND'},metadata:{is_tool_call:true},tool_calls:[{arguments:'PRIVATE_ARGS'}],function_call:{arguments:'PRIVATE_ARGS'}}},
 output:{parent:'code',children:['final'],message:{author:{role:'tool',name:'PRIVATE_TOOL_NAME'},recipient:'PRIVATE_RECIPIENT',content:{content_type:'execution_output',parts:[{type:'PRIVATE_TYPE',text:'PRIVATE_OUTPUT'}]},metadata:{message_type:'PRIVATE_MESSAGE_TYPE',unknown:'PRIVATE_VALUE'}}},
 final:{parent:'output',children:[],message:{author:{role:'assistant'},channel:'final',recipient:'all',end_turn:true,status:'finished_successfully',content:{content_type:'text',parts:['PRIVATE_FINAL']}}},
 alternate:{parent:'user',children:[],message:{author:{role:'assistant'},channel:'PRIVATE_CHANNEL',content:{content_type:'PRIVATE_CONTENT_TYPE',parts:['PRIVATE_ALT']}}}
}};
let n=0;const pass=name=>{n++;console.log('PASS',name);};
async function read(data=fixture,markers=true,options={}){
 const calls=[];
 const context=vm.createContext({location:{hostname:'chatgpt.com',pathname:'/c/test'},AbortController,setTimeout,clearTimeout,fetch:async(url,config)=>{
 calls.push({url,config});return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>calls.length===1?{accessToken:'PRIVATE_TOKEN'}:data};
 },...options});
 vm.runInContext(fs.readFileSync(dir+'reader.js','utf8'),context);
 return {result:await context.readChatGPTPage('test',markers),calls};
}
async function run(){
 let {result,calls}=await read();const d=result.diagnostics;
 assert(d);assert(!result.data);assert.equal(d.schemaVersion,'message-markers-1');assert.equal(d.messageCount,6);
 assert(!JSON.stringify(result).includes('PRIVATE_'));assert.equal(calls.length,2);assert.equal(calls[1].config.headers.Authorization,'Bearer PRIVATE_TOKEN');
 pass('Marker mode returns categorical diagnostics without source content, IDs, title, arguments or token');
 const code=d.messages.find(m=>m.contentType==='code');assert.equal(code.channel,'missing');assert.equal(code.recipient,'functions.exec_command');assert.equal(code.recipientLooksLikeTool,true);assert.equal(code.language,'bash');assert.equal(code.toolCallsCount,1);assert.equal(code.functionCallPresent,true);assert.equal(code.toolCallMarked,true);
 pass('Null-channel code preserves tool recipient, content type and call markers instead of guessing from text');
 const output=d.messages.find(m=>m.role==='tool');assert.equal(output.authorName,'other');assert.equal(output.recipient,'other');assert.equal(output.messageType,'other');assert.deepEqual(Array.from(output.partTypes),['other']);
 pass('Unrecognized structural values are reported as other without echoing arbitrary strings');
 assert.equal(d.messages.find(m=>m.channel==='analysis').internal,true);assert.equal(d.messages.find(m=>m.channel==='final').endTurn,true);assert.equal(d.messages.find(m=>m.channel==='other').onCurrentPath,false);assert.equal(d.currentPathMessages,5);assert.equal(d.pathIncomplete,false);
 pass('Analysis, final and alternate nodes remain inspectable with path membership and no filtering change');
 const cycle=structuredClone(fixture);cycle.mapping.root.parent='final';const cycled=(await read(cycle)).result.diagnostics;assert.equal(cycled.pathIncomplete,true);assert.equal(cycled.messages.length,6);
 pass('Cycles terminate and are marked incomplete rather than hanging diagnostics');
 const normal=(await read(fixture,false)).result;assert(normal.data.mapping);assert(!normal.diagnostics);assert.equal(normal.data.mapping.code.message.channel,undefined);assert.equal(normal.data.mapping.code.message.content.text,'PRIVATE_COMMAND');assert.equal(normal.data.mapping.code.message.recipient,'functions.exec_command');assert.equal(normal.data.mapping.code.message.toolCall,true);assert.equal(normal.data.mapping.analysis.message.metadata.is_internal,true);assert.equal(normal.data.mapping.final.message.end_turn,true);assert(!normal.data.mapping.code.message.tool_calls);assert(!normal.data.mapping.code.message.function_call);
 pass('Normal reader preserves routing/type markers without exporting tool-call argument fields');
 const wrong=await read(fixture,true,{location:{hostname:'evil.example',pathname:'/c/test'}});assert.equal(wrong.calls.length,0);assert.equal(wrong.result.error,'PAGE_CHANGED');
 pass('Marker mode cannot read data from an unrelated origin');
 const state={'atlas:settings':{autoCapture:false}},listeners=[],execs=[];let tab={id:7,url:'https://chatgpt.com/c/test'};
 const context=vm.createContext({URL,console,Atlas:A,readChatGPTPage:()=>{},importScripts:()=>{},chrome:{sidePanel:{setPanelBehavior:async()=>{}},tabs:{get:async()=>tab},scripting:{executeScript:async options=>{execs.push(options);return [{result}];}},runtime:{onMessage:{addListener:f=>listeners.push(f)}},storage:{local:{get:async key=>({[key]:state[key]}),set:async()=>assert.fail('Diagnostic must not write storage')}}}});
 vm.runInContext(fs.readFileSync(dir+'trust.js','utf8')+'\n'+fs.readFileSync(dir+'background.js','utf8'),context);
 const send=(message,sender={})=>new Promise(resolve=>listeners[0](message,sender,resolve));
 let reply=await send({type:'diagnose-message-markers',tabId:7});assert(reply.messageMarkers);assert.equal(execs[0].args[1],true);
 pass('Trusted diagnostics work while automatic capture is paused and never write records or queue AI work');
 const before=execs.length;reply=await send({type:'diagnose-message-markers',tabId:7},{tab});assert(reply.error.includes('扩展界面'));assert.equal(execs.length,before);
 pass('Website content scripts cannot initiate the privileged marker diagnostic');
 context.chrome.scripting.executeScript=async()=>{tab={id:7,url:'https://chatgpt.com/c/other'};return [{result}];};reply=await send({type:'diagnose-message-markers',tabId:7});assert(reply.error.includes('切换'));assert(!reply.messageMarkers);
 pass('Switching conversations during the read discards diagnostic results');
 tab={id:7,url:'https://chatgpt.com/c/test'};context.chrome.scripting.executeScript=async()=>[{result:{error:'HTTP_401'}}];reply=await send({type:'diagnose-message-markers',tabId:7});assert(reply.error.includes('登录状态'));assert(!reply.messageMarkers);
 pass('Authentication failures stay explicit without returning partial data or credentials');
 const p=page('panel');await flush();let copied='';p.c.navigator={clipboard:{writeText:async text=>{copied=text;}}};p.c.markerFixture=structuredClone(d);
 p.c.chrome.runtime.sendMessage=async m=>{assert.equal(m.type,'diagnose-message-markers');return {messageMarkers:structuredClone(d)};};
 await p.nodes.get('diagnose').onclick();assert(JSON.parse(p.nodes.get('diagnostic').textContent).messageMarkers);assert.equal(p.nodes.get('diagnostic').hidden,false);assert.equal(copied,p.nodes.get('diagnostic').textContent);assert.equal(p.nodes.get('diagnose').disabled,false);
 pass('The existing diagnostic button displays and copies markers, then releases its busy state');
 console.log(`All ${n} message marker checks passed.`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
