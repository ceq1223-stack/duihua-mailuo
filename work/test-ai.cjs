const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const dir='outputs/topic-atlas-extension/';
const A=require('../'+dir+'core.js'),AI=require('../'+dir+'ai.js');
const clone=v=>structuredClone(v),m=(id,role,text)=>({id,nativeId:id,role,text});
const record={key:'ChatGPT:https://chatgpt.com/c/test',platform:'ChatGPT',url:'https://chatgpt.com/c/test',title:'test',annotations:{},source:{completeness:'returned-tree'},messages:[m('u1','user','先设计主题中心架构'),m('a1','assistant','按主题组织，保留原消息。'),m('u2','user','转向竞品调查，看看相似产品'),m('a2','assistant','建议先调查功能和限制。'),m('u3','user','回到主题中心架构继续完善')]};
record.source.type='chatgpt-api';
record.allMessages=[...record.messages,m('alt','assistant','其他分支的秘密文本')];
record.branches=[{id:'current',label:'网页当前路径',messageIds:record.messages.map(m=>m.id)},{id:'alternate',label:'其他分支 1',messageIds:['u1','alt']}];
const ev=(id,msg,quote,role='user')=>({roundId:id,messageId:msg,role,quote});
const valid={schemaVersion:'1.0',branchId:'current',topics:[{id:'t001',name:'主题中心架构',summary:'围绕主题组织对话，并在竞品调查后回归架构。',roundIds:['u1','u3']},{id:'t002',name:'竞品调查',summary:'用户要求调查相似产品。助手建议调查功能和限制。',roundIds:['u2']}],timeline:[{roundId:'u1',primaryTopicId:'t001',secondaryTopicIds:[],title:'讨论主题中心架构',userSummary:'用户要求设计主题中心架构。',assistantSummary:'助手建议按主题组织并保留原消息。',evidence:[ev('u1','u1','先设计主题中心架构')]},{roundId:'u2',primaryTopicId:'t002',secondaryTopicIds:[],title:'转向相似产品调查',userSummary:'用户转向竞品调查。',assistantSummary:'助手建议先调查功能和限制。',evidence:[ev('u2','u2','转向竞品调查，看看相似产品')]},{roundId:'u3',primaryTopicId:'t001',secondaryTopicIds:[],title:'重新完善主题架构',userSummary:'用户回到架构继续完善。',assistantSummary:null,evidence:[ev('u3','u3','回到主题中心架构继续完善')]}],relations:[{from:'t001',to:'t002',type:'branch',atRoundId:'u2',label:'转向竞品',reason:'用户明确转向竞品调查。',inferred:false,evidence:[ev('u2','u2','转向竞品调查')]},{from:'t002',to:'t001',type:'return',atRoundId:'u3',label:'回归架构',reason:'用户明确回到已有架构主题。',inferred:false,evidence:[ev('u3','u3','回到主题中心架构')]}],warnings:[]};
valid.topics[0].brief='讨论以知识主题组织对话的架构。';valid.topics[1].brief='调查相似产品的功能与限制。';
let n=0;const pass=name=>{n++;console.log('PASS',name)};
async function run(){
 const input=AI.prepare(record).input;
 assert(!JSON.stringify(input).includes('其他分支的秘密文本'));assert(!JSON.stringify(input).includes('https://'));assert.equal(input.rounds.length,3);assert.equal(AI.validate(valid,input).relations[1].type,'return');pass('Selected path only; stable source references and branch/return output');
 for(const [name,mutate] of [
  ['fabricated quote',v=>v.timeline[0].evidence[0].quote='捏造的原文'],
  ['wrong source role',v=>v.timeline[0].evidence[0].role='assistant'],
  ['unknown message ID',v=>v.timeline[0].evidence[0].messageId='fake'],
  ['missing round',v=>v.timeline.pop()],
  ['reordered rounds',v=>v.timeline.reverse()],
  ['missing role hallucination',v=>v.timeline[2].assistantSummary='虚构的回答'],
  ['duplicate topic',v=>v.topics[1].name=v.topics[0].name],
  ['unknown topic reference',v=>v.timeline[0].primaryTopicId='fake'],
  ['membership mismatch',v=>v.topics[0].roundIds=['u1']],
  ['no evidence edge',v=>v.relations[0].evidence=[]],
  ['reversed return',v=>{v.relations[1].from='t001';v.relations[1].to='t002'}],
  ['return before first visit',v=>v.relations[0].type='return'],
  ['cross branch response',v=>v.branchId='alternate'],
  ['duplicate edge',v=>v.relations.push(clone(v.relations[0]))]
 ]){const broken=clone(valid);mutate(broken);assert.throws(()=>AI.validate(broken,input));pass('Reject '+name)}
 const annotated=clone(input);annotated.manualAnnotations=[{roundId:'u1',topic:'人工架构名称'}];assert.throws(()=>AI.validate(valid,annotated));pass('Manual topic cannot be silently overwritten');
 const huge=clone(record);huge.allMessages[0].text='字'.repeat(240001);assert.equal(AI.prepare(huge).input.rounds[0].messages[0].text.length,240001);pass('Long source remains intact for budgeted batch planning');
 for(const address of ['http://api.example/v1','https://key:pass@api.example/v1','https://api.example/v1?key=secret','https://api.example/v1#token'])assert.throws(()=>AI.endpoint(address));assert.equal(AI.endpoint('https://api.example/v1/chat/completions/').chatUrl,'https://api.example/v1/chat/completions');pass('Endpoint validation and full endpoint normalization');
 const local={['conversation:'+record.key]:clone(record)},session={},listeners=[],changes=[],access=[],calls=[];
 const area=(store,name)=>({get:async key=>key===null?clone(store):{[key]:clone(store[key])},set:async obj=>{Object.assign(store,clone(obj));changes.forEach(fn=>fn(Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,{newValue:v}])),'local'))},remove:async key=>delete store[key],setAccessLevel:async value=>access.push([name,value.accessLevel])});
 let allowed=true,responder=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}],usage:{total_tokens:100}}),{status:200});
 const context=vm.createContext({console,URL,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,fetch:async(url,opts)=>{calls.push({url,opts});return responder(url,opts)},chrome:{permissions:{contains:async()=>allowed},sidePanel:{setPanelBehavior:async()=>{}},tabs:{query:async()=>[],sendMessage:async()=>{}},runtime:{getPlatformInfo:async()=>({os:'win'}),onMessage:{addListener:f=>listeners.push(f)}},storage:{local:area(local,'local'),session:area(session,'session'),onChanged:{addListener:f=>changes.push(f)}}}});
 context.TextDecoder=TextDecoder;
 context.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(dir+f,'utf8'),context,{filename:f}));
 vm.runInContext(fs.readFileSync(dir+'background.js','utf8'),context);
 const send=(message,sender={})=>new Promise(resolve=>listeners[0](message,sender,resolve));
 const config={provider:'openai',model:'test-model',baseUrl:'https://api.openai.com/v1',maxTokens:12000,jsonMode:true,rememberKey:false,reuseResults:false};
 let result=await send({type:'ai-save-config',config,apiKey:'TEST_ONLY_SECRET'});assert(result.ok);assert(access.some(a=>a[0]==='local'&&a[1]==='TRUSTED_CONTEXTS'));assert(!JSON.stringify(local).includes('TEST_ONLY_SECRET'));assert(JSON.stringify(session).includes('TEST_ONLY_SECRET'));pass('Session-only key and trusted-context local storage');
 const safe=await send({type:'ai-get-config'});assert(safe.profiles.openai.hasKey);assert(!JSON.stringify(safe).includes('TEST_ONLY_SECRET'));pass('Configuration read never returns secret');
 const attack=await send({type:'ai-extract',key:record.key,branchId:'current'},{tab:{id:1}});assert(attack.error);assert.equal(calls.length,0);pass('Content script cannot start paid API requests');
 result=await send({type:'ai-extract',key:record.key,branchId:'current'});assert(result.ok,result.error);let saved=clone(local['conversation:'+record.key].aiResults.current);assert.equal(saved.result.topics.length,2);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/chat/completions');assert.equal(calls[0].opts.redirect,'error');assert.equal(calls[0].opts.credentials,'omit');const body=JSON.parse(calls[0].opts.body);assert.equal(body.max_completion_tokens,12000);assert(!body.max_tokens);assert(!JSON.stringify(local['conversation:'+record.key]).includes('TEST_ONLY_SECRET'));pass('Request payload, response validation, persistence and export secret exclusion');
 for(const provider of ['kimi','deepseek','custom']){
  const conf={...config,provider,baseUrl:provider==='custom'?'https://custom.example/v1':AI.presets[provider].baseUrl};
  assert((await send({type:'ai-save-config',config:conf,apiKey:'TEST_ONLY_'+provider})).ok);
  result=await send({type:'ai-extract',key:record.key,branchId:'current'});assert(result.ok,result.error);const latest=JSON.parse(calls.at(-1).opts.body);assert.equal(latest.max_tokens,12000);assert(!latest.max_completion_tokens);assert(calls.at(-1).url.startsWith(conf.baseUrl));
 }pass('Kimi, DeepSeek and custom compatibility adapters');
 await send({type:'ai-save-config',config:{...config,provider:'custom',baseUrl:'https://other.example/v1'}});const cleared=await send({type:'ai-get-config'});assert(!cleared.profiles.custom.hasKey);pass('Changing custom origin never forwards previous key');
 await send({type:'ai-save-config',config:{...config,rememberKey:true}});assert(JSON.stringify(local['atlas:ai']).includes('TEST_ONLY_SECRET'));assert(!JSON.stringify(session).includes('TEST_ONLY_SECRET'));pass('Explicit persistent-key option moves key out of session');
 allowed=false;const before=calls.length;result=await send({type:'ai-extract',key:record.key});assert(result.error);assert.equal(before,calls.length);allowed=true;pass('Missing host grant blocks outbound request');
 responder=async()=>new Response('SERVER_ECHOED_TEST_ONLY_SECRET',{status:401});result=await send({type:'ai-extract',key:record.key});assert(result.error.includes('401'));assert(!result.error.includes('TEST_ONLY_SECRET'));assert.deepEqual(local['conversation:'+record.key].aiResults.current.result,valid);pass('HTTP errors redact response body and retain previous result without retry');
 responder=async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}));result=await send({type:'ai-extract',key:record.key});assert(result.error.includes('长度上限'));pass('Truncated model output is rejected');
 responder=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...valid,timeline:[]})}}]}));result=await send({type:'ai-extract',key:record.key});assert(result.error.includes('校验失败'));pass('Invalid model result cannot replace graph');
 const sse=': keep-alive\n\ndata: '+JSON.stringify({choices:[{delta:{reasoning_content:'NEVER_STORE_REASONING'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(valid)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
 responder=async()=>{const bytes=new TextEncoder().encode(sse);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=37)controller.enqueue(bytes.slice(i,i+37));controller.close()}}),{headers:{'content-type':'text/event-stream'}})};
 result=await send({type:'ai-extract',key:record.key});assert(result.ok,result.error);assert(!JSON.stringify(local).includes('NEVER_STORE_REASONING'));assert.equal(JSON.parse(calls.at(-1).opts.body).stream,true);pass('Streaming UTF-8 response, split SSE lines and ignored reasoning');
 responder=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(valid)}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});result=await send({type:'ai-extract',key:record.key});assert(result.error);pass('Interrupted stream without final completion cannot commit');
 let release;responder=()=>new Promise(resolve=>{release=resolve});const pending=send({type:'ai-extract',key:record.key});await new Promise(r=>setImmediate(r));assert((await send({type:'ai-job',key:record.key})).running);const duplicate=await send({type:'ai-extract',key:record.key});assert(duplicate.error.includes('正在抽取'));const capture=await send({type:'get-auto-settings'});assert.equal(capture.enabled,true);local['conversation:'+record.key].messages[0].text+='更新';local['conversation:'+record.key].allMessages[0].text+='更新';release(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}]})));result=await pending;assert(result.error.includes('发生变化'));assert.equal((await send({type:'ai-job',key:record.key})).running,false);pass('Concurrent capture remains responsive; stale snapshot never commits');
 responder=(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted'))));const cancelPending=send({type:'ai-extract',key:record.key});await new Promise(r=>setImmediate(r));await send({type:'ai-cancel',key:record.key});result=await cancelPending;assert(result.error.includes('取消'));pass('Cancellation aborts in-flight request');
 await send({type:'ai-save-config',config,clearKey:true});assert(!(await send({type:'ai-get-config'})).profiles.openai.hasKey);pass('Clear key removes both persistent and session credentials');
 const compatibleRecord=clone(record);compatibleRecord.aiResults={current:{result:valid,sourceMessages:record.messages.map(m=>[m.id,A.hash(JSON.stringify([m.role,m.text]))])}};
 assert(AI.prepare(compatibleRecord).input.previousResult);compatibleRecord.branches[0].messageIds=['u1','alt'];assert.equal(AI.prepare(compatibleRecord).input.previousResult,null);pass('Current branch alias never sends previous version summaries into a different path');
 const beforeTestState=JSON.stringify({local,session});
 responder=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"status":"ok"}'}}]}));
 result=await send({type:'ai-test',config,apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.ok,result.error);assert.equal(JSON.stringify({local,session}),beforeTestState);const testBody=JSON.parse(calls.at(-1).opts.body);assert.equal(testBody.model,config.model);assert.equal(testBody.max_completion_tokens,2048);assert(!JSON.stringify(testBody).includes(record.messages[0].text));assert(!JSON.stringify(result).includes('TEST_ONLY_DRAFT_KEY'));pass('Connection test sends a tiny draft-config inference without saving or sending conversation');
 result=await send({type:'ai-test',config:{...config,provider:'kimi'},apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.ok);assert.equal(JSON.parse(calls.at(-1).opts.body).max_tokens,2048);pass('Connection test uses compatible token parameter for other providers');
 const countBefore=calls.length;result=await send({type:'ai-test',config,apiKey:'TEST_ONLY_DRAFT_KEY'},{tab:{id:1}});assert(result.error);assert.equal(calls.length,countBefore);pass('Content scripts cannot initiate paid connection tests');
 result=await send({type:'ai-test',config:{...config,model:''},apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.error.includes('模型 ID'));assert.equal(calls.length,countBefore);pass('Missing model is rejected before any connection request');
 responder=async()=>new Response('test key should not be echoed',{status:401});result=await send({type:'ai-test',config,apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.error.includes('401'));assert(!result.error.includes('echoed'));pass('Connection test shows meaningful HTTP failure without response body');
 responder=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:''}}]}));result=await send({type:'ai-test',config,apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.error.includes('正文'));pass('HTTP 200 with empty model content does not pass connection test');
 responder=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'OK'}}]}));result=await send({type:'ai-test',config,apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.error.includes('JSON'));result=await send({type:'ai-test',config:{...config,jsonMode:false},apiKey:'TEST_ONLY_DRAFT_KEY'});assert(result.ok);pass('Connection test verifies JSON mode and supports text mode');
 console.log(`All ${n} API checks passed.`);
}
module.exports={record,valid};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
