const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const A=require('../outputs/topic-atlas-extension/core.js');
const fixture={title:'测试对话',current_node:'a2',mapping:{
 root:{parent:null,children:['s'],message:null},s:{parent:'root',children:['u'],message:{id:'system',author:{role:'system'},content:{content_type:'text',parts:['不要展示系统内容']}}},
 u:{parent:'s',children:['a1','a2'],message:{id:'u',author:{role:'user'},create_time:100,content:{content_type:'text',parts:['测试用户问题']}}},
 a1:{parent:'u',children:[],message:{id:'a1',author:{role:'assistant'},content:{content_type:'text',parts:['旧的回复']}}},
 a2:{parent:'u',children:[],message:{id:'a2',author:{role:'assistant'},content:{content_type:'text',parts:['当前回复']}}}
}};
let passed=0;
function test(name,f){f();passed++;console.log('PASS',name)}
test('Structured roles, native IDs, timestamps, active path and alternate branch',()=>{
 const r=A.normalizeChatGPT(fixture);assert.equal(r.allMessages.length,3);assert.deepEqual(r.messages.map(m=>m.nativeId),['u','a2']);assert.equal(r.messages[0].role,'user');assert.equal(r.messages[1].role,'assistant');assert.equal(r.messages[0].createdAt,'1970-01-01T00:01:40.000Z');assert.equal(r.branches.length,2);assert.deepEqual(r.branches[1].messageIds,['user:u','assistant:a1']);assert.equal(r.source.completeness,'returned-tree');
});
test('Missing current node reports partial without guessing an active path',()=>{const r=A.normalizeChatGPT({...fixture,current_node:'missing'});assert.equal(r.source.completeness,'partial');assert.equal(r.messages.length,0);assert(r.branches.length>1)});
test('Missing parent or child is partial',()=>{const d=structuredClone(fixture);d.mapping.u.parent='missing';assert.equal(A.normalizeChatGPT(d).source.completeness,'partial')});
test('Multimodal text retains readable text and marks unextracted attachment',()=>{const d=structuredClone(fixture);d.mapping.u.message.content={content_type:'multimodal_text',parts:['看这张图',{content_type:'image_asset_pointer',asset_pointer:'not-returned-in-text'}]};const r=A.normalizeChatGPT(d);assert.equal(r.messages[0].text,'看这张图');assert.equal(r.source.omittedNonText,1)});
test('Hidden and tool messages excluded from conversation body',()=>{const d=structuredClone(fixture);d.mapping.a1.message.metadata={is_visually_hidden_from_conversation:true};assert.equal(A.normalizeChatGPT(d).allMessages.length,2)});
test('Empty and malformed response fails explicitly',()=>{assert.throws(()=>A.normalizeChatGPT({mapping:[]}),/SCHEMA_CHANGED/);assert.throws(()=>A.normalizeChatGPT({mapping:{}}),/NO_MESSAGES/)});
test('Cycle terminates and reports partial',()=>{const d=structuredClone(fixture);d.mapping.s.parent='u';assert.equal(A.normalizeChatGPT(d).source.completeness,'partial')});
test('Code and object text parts are readable text, not attachments',()=>{const d=structuredClone(fixture);d.mapping.a2.message.content={content_type:'code',text:'const answer = 42;'};d.mapping.u.message.content={parts:[{type:'text',content:'嵌套文本'}]};const r=A.normalizeChatGPT(d);assert.equal(r.messages[0].text,'嵌套文本');assert.equal(r.messages[1].text,'const answer = 42;');assert.equal(r.source.omittedNonText,0)});
test('Empty nodes are skipped without fabricated attachment placeholders',()=>{const d=structuredClone(fixture);d.mapping.a1.message.content={content_type:'text',parts:['']};const r=A.normalizeChatGPT(d);assert.equal(r.source.omittedNonText,0);assert.equal(r.source.skippedEmpty,1);assert.equal(r.allMessages.length,2);assert(!r.allMessages.some(m=>m.text.includes('非文本消息')))});
test('Unknown body type is partial unreadable content, not a proven attachment',()=>{const d=structuredClone(fixture);d.mapping.a1.message.content={content_type:'new_payload',body:{unknown:true}};const r=A.normalizeChatGPT(d);assert.equal(r.source.unreadableContent,1);assert.equal(r.source.omittedNonText,0);assert.equal(r.source.completeness,'partial')});
async function pageRun(responses,options={}){
 const calls=[];const context={location:{hostname:'chatgpt.com',pathname:'/c/test'},AbortController,setTimeout,clearTimeout,fetch:async(url,config)=>{calls.push({url,config});const x=responses.shift();if(x instanceof Error)throw x;return x},...options};
 vm.createContext(context);vm.runInContext(fs.readFileSync('outputs/topic-atlas-extension/reader.js','utf8'),context);
 const result=await context.readChatGPTPage('test');return {result,calls};
}
const response=(body,status=200,json=true)=>({ok:status>=200&&status<300,status,headers:{get:()=>json?'application/json':'text/html'},json:async()=>body});
async function run(){
 let out=await pageRun([response({accessToken:'test-token-do-not-leak',privateField:'private'}),response(fixture)]);
 assert.equal(out.calls.length,2);assert.equal(out.calls[1].config.headers.Authorization,'Bearer test-token-do-not-leak');assert(!JSON.stringify(out.result).includes('test-token'));assert(!JSON.stringify(out.result).includes('private'));assert(out.result.data.mapping);console.log('PASS MAIN reader uses current login, returns allowlisted data, never returns token');passed++;
 out=await pageRun([response({},401),response({},401)]);assert.equal(out.result.error,'HTTP_401');console.log('PASS authentication failure stays explicit');passed++;
 out=await pageRun([response({}),response({},403)]);assert.equal(out.result.error,'HTTP_403');console.log('PASS denied request not bypassed');passed++;
 out=await pageRun([response({}),response('<html>',200,false)]);assert.equal(out.result.error,'NOT_JSON');console.log('PASS HTML challenge never parsed as conversation');passed++;
 out=await pageRun([response({}),response({other:true})]);assert.equal(out.result.error,'SCHEMA_CHANGED');console.log('PASS unknown response schema fails');passed++;
 out=await pageRun([],{location:{hostname:'evil.example',pathname:'/c/test'}});assert.equal(out.calls.length,0);assert.equal(out.result.error,'PAGE_CHANGED');console.log('PASS reader never fetches from other origins');passed++;
 const state={},listeners=[],tab={id:7,url:'https://chatgpt.com/c/test',title:'Test'};
 const context={URL,console,Atlas:A,readChatGPTPage:()=>{},importScripts:()=>{},chrome:{sidePanel:{setPanelBehavior:async()=>{}},tabs:{get:async()=>tab},scripting:{executeScript:async()=>[{result:{data:fixture}}]},runtime:{onMessage:{addListener:f=>listeners.push(f)}},storage:{local:{get:async key=>({[key]:state[key]}),set:async object=>Object.assign(state,object),remove:async key=>delete state[key]}}}};
 vm.runInNewContext(fs.readFileSync('outputs/topic-atlas-extension/trust.js','utf8')+'\n'+fs.readFileSync('outputs/topic-atlas-extension/background.js','utf8'),context);
 const send=(m,s={tab})=>new Promise(resolve=>listeners[0](m,s,resolve));
 const result=await send({type:'read-structured'});assert.equal(result.count,3);assert.equal(result.activeCount,2);
 const key='conversation:ChatGPT:https://chatgpt.com/c/test';assert.equal(state[key].allMessages.length,3);assert.equal(state[key].branches.length,2);
 await send({type:'annotate',key:state[key].key,turnId:'assistant:a1',topic:'其他分支'},{});assert.equal(state[key].annotations['assistant:a1'].topic,'其他分支');
 state[key].aiResults={current:{model:'fixture-model',result:{topics:[]}}};state[key].aiDrafts={current:{roundSignatures:[['u1','test-hash']]}};
 await send({type:'read-structured'});assert.equal(state[key].annotations['assistant:a1'].topic,'其他分支');assert.equal(state[key].aiResults.current.model,'fixture-model');assert.equal(state[key].aiDrafts.current.roundSignatures[0][0],'u1');console.log('PASS worker saves whole tree and preserves annotations, API results and checkpoints');passed++;
 const pageListeners=[];
 const pageContext={Atlas:{...A,extract:()=>{throw new Error('DOM extraction must not run for ChatGPT capture')}},location:{href:tab.url},document:{documentElement:{},addEventListener:()=>{}},console,Date,setTimeout,clearTimeout,setInterval:()=>1,MutationObserver:class{observe(){}},chrome:{storage:{local:{get:async()=>({})},onChanged:{addListener:()=>{}}},runtime:{getManifest:()=>({version:'0.3.0'}),onMessage:{addListener:f=>pageListeners.push(f)},sendMessage:m=>send(m)}}};
 vm.runInNewContext(fs.readFileSync('outputs/topic-atlas-extension/automatic.js','utf8'),pageContext);
 const started=await new Promise(resolve=>pageListeners[0]({type:'start'},{},resolve));assert.equal(started.count,3);assert.equal(started.source.type,'chatgpt-api');
 const status=await new Promise(resolve=>pageListeners[0]({type:'status'},{},resolve));assert(status.running);assert.equal(status.source.type,'chatgpt-api');
 await new Promise(resolve=>pageListeners[0]({type:'stop'},{},resolve));
 console.log('PASS content → worker → structured save roundtrip never uses rendered message extraction');passed++;
 state['atlas:settings']={autoCapture:false};context.chrome.scripting.executeScript=async()=>{throw new Error('Paused capture must not execute reader')};
 const paused=await send({type:'read-structured'});assert(paused.error.includes('暂停'));console.log('PASS worker blocks automatic requests when paused');passed++;
 console.log('All '+passed+' structured checks passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
