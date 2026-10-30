const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const A=require('../outputs/topic-atlas-extension/core.js'),AI=require('../outputs/topic-atlas-extension/ai.js'),B=require('../outputs/topic-atlas-extension/batch.js'),P=require('../outputs/topic-atlas-extension/prompt.js');
const clone=v=>structuredClone(v),dir='outputs/topic-atlas-extension/';
function makeRecord(count=13,padding='') {
 const messages=[];
 for(let i=0;i<count;i++)messages.push({id:'u'+i,role:'user',text:(i%3===1?'转向竞品调查':'回到主题架构')+' 第'+i+'轮 '+padding},{id:'a'+i,role:'assistant',text:'助手给出第'+i+'轮的建议。'});
 return {key:'ChatGPT:https://chatgpt.com/c/batch',url:'https://chatgpt.com/c/batch',platform:'ChatGPT',title:'batch',annotations:{},messages,allMessages:messages,branches:[{id:'current',label:'网页当前路径',messageIds:messages.map(m=>m.id)}],source:{type:'chatgpt-api',filterVersion:A.answerFilterVersion,completeness:'returned-tree'}};
}
function modelOutput(input) {
 const topics=[],timeline=[],relations=[],known=[...(input.context?.topics || [])];let previous=input.context?.lastTopicId;
 for(const r of input.rounds){
  const user=r.messages.find(m=>m.role==='user'),assistant=r.messages.find(m=>m.role==='assistant');
  const name=(user.text||user.fragmentMemory?.notes||'').includes('竞品')?'竞品调查':'主题架构';
  let topic=known.find(t=>t.name===name),seen=!!topic;
  if(!topic){topic={id:(input.newTopicPrefix || 't')+(name==='竞品调查'?'research':'architecture'),name};known.push(topic)}
  let current=topics.find(t=>t.id===topic.id);if(!current){current={id:topic.id,name,brief:'讨论'+name+'的内容、方案及变化。',summary:'该主题的分段讨论摘要。',roundIds:[]};topics.push(current)}current.roundIds.push(r.roundId);
  const evidence=[{roundId:r.roundId,messageId:user.messageId,role:'user',quote:user.text?user.text.slice(0,30):user.quoteCandidates[0]}];
  timeline.push({roundId:r.roundId,primaryTopicId:topic.id,secondaryTopicIds:[],title:'整理本轮讨论',userSummary:'用户讨论'+name,assistantSummary:assistant?'助手提供本轮建议':null,evidence});
  if(previous && previous!==topic.id)relations.push({from:previous,to:topic.id,type:seen?'return':'branch',atRoundId:r.roundId,label:seen?'回归主题':'探索分支',reason:'根据本轮用户的明确讨论方向。',inferred:false,evidence});
  previous=topic.id;
 }
 return {schemaVersion:'1.0',branchId:input.branchId,topics,timeline,relations,directions:[],directionUpdates:[],warnings:[]};
}
function harness(record){
 const state={['conversation:'+record.key]:clone(record)},session={},listeners=[],changes=[],calls=[],historyCalls=[],briefCalls=[],fragmentCalls=[];
 const storage=store=>({get:async key=>({[key]:clone(store[key])}),set:async obj=>Object.assign(store,clone(obj)),remove:async key=>delete store[key],setAccessLevel:async()=>{}});
 let responder=async (url,options,input)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(input))}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));
 let historyResponder=async input=>require('./history-fixture.cjs').response(require('./history-fixture.cjs').selection(input)),briefResponder=async input=>require('./history-fixture.cjs').response(require('./history-fixture.cjs').briefs(input)),fragmentResponder=async input=>require('./history-fixture.cjs').response(require('./fragment-fixture.cjs')(input));
 const ctx=vm.createContext({URL,console,AbortController,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,fetch:async(url,options)=>{const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);if(input.stage==='fragment-read'){fragmentCalls.push({url,body,input});return fragmentResponder(input,options);}if(input.stage==='topic-briefs'){briefCalls.push({url,body,input});return briefResponder(input,options);}if(input.stage==='history-select'){historyCalls.push({url,body,input});return historyResponder(input,options);}calls.push({url,body,input});return responder(url,options,input)},chrome:{sidePanel:{setPanelBehavior:async()=>{}},permissions:{contains:async()=>true},runtime:{getPlatformInfo:async()=>({os:'win'}),onMessage:{addListener:f=>listeners.push(f)}},storage:{local:storage(state),session:storage(session),onChanged:{addListener:f=>changes.push(f)}},tabs:{query:async()=>[],sendMessage:async()=>{}}}});
 ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(dir+file,'utf8'),ctx,{filename:file}));vm.runInContext(fs.readFileSync(dir+'background.js','utf8'),ctx);
 const send=(message,sender={})=>new Promise(resolve=>listeners[0](message.type==='ai-save-config'?{...message,config:require('./capability-fixture.cjs')(message.config)}:message,sender,resolve));
 return {state,calls,historyCalls,briefCalls,fragmentCalls,context:ctx,send,setResponder:fn=>responder=fn,setHistoryResponder:fn=>historyResponder=fn,setBriefResponder:fn=>briefResponder=fn,setFragmentResponder:fn=>fragmentResponder=fn};
}
let passed=0;function pass(s){passed++;console.log('PASS',s)}
async function run(){
 const record=makeRecord(35,'正文'.repeat(150)),input=AI.prepare(record).input,profile=AI.config({provider:'openai',model:'mock',inputBudget:9000,batchRounds:6}),system=P.default+P.contract+P.batchContract;
 let result=B.empty('current'),offset=0,steps=0;
 while(offset<input.rounds.length){const batch=B.next(input,offset,result,profile,system);assert(batch.estimatedTokens<=profile.inputBudget);assert(batch.input.rounds.length<=6);assert.equal(batch.input.previousResult,null);assert(batch.input.context.topics.length<=24);assert(batch.input.rounds[0].messages[0].text.length>300);const delta=AI.validate(modelOutput(batch.input),batch.input);result=B.merge(result,delta,input.rounds);offset+=batch.input.rounds.length;steps++}
 result=AI.validate(result,input);assert.equal(result.timeline.length,35);assert.equal(result.topics.length,2);assert(steps>1);assert(result.relations.some(e=>e.type==='return'));pass('Budgeted complete-round chunks merge into one graph with cross-chunk returns');
 const long=makeRecord(400,'文'.repeat(800));const full=AI.prepare(long).input;assert.equal(full.rounds.length,400);assert(JSON.stringify(full.rounds).length>240000);assert(B.next(full,0,B.empty('current'),profile,system).input.rounds.length<400);pass('More than 300 rounds and 240k characters no longer requires one request');
 assert.throws(()=>B.next(AI.prepare(makeRecord(1,'文'.repeat(10000))).input,0,B.empty('current'),profile,system),/单轮/);pass('Oversize single round fails explicitly without dropping original text');
 assert.throws(()=>B.next(input,0,B.empty('current'),profile,'长'.repeat(10000)),/提示词/);pass('Prompt overhead is included in input budget');
 const src=makeRecord(13),h=harness(src),config={provider:'openai',model:'mock',batchRounds:3,inputBudget:12000,maxTokens:12000};
 assert((await h.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_BATCH_KEY'})).ok);
 let answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.requests,5);assert.equal(answer.reusedRounds,0);assert.equal(h.state['conversation:'+src.key].aiResults.current.result.timeline.length,13);assert(!h.state['conversation:'+src.key].aiDrafts.current);pass('Worker processes five chunks and publishes only a complete final graph');
 let previousCalls=h.calls.length;answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok);assert.equal(answer.requests,0);assert.equal(h.calls.length,previousCalls);assert.equal(answer.reusedRounds,13);pass('Unchanged conversation reuses verified results without API calls');
 let latest=h.state['conversation:'+src.key];latest.messages.push({id:'u13',role:'user',text:'转向竞品调查 新轮次'},{id:'a13',role:'assistant',text:'新回复'});latest.allMessages=latest.messages;latest.branches[0].messageIds=latest.messages.map(m=>m.id);
 answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.requests,1);assert.equal(answer.reusedRounds,13);assert.equal(h.calls.at(-1).input.rounds.length,1);assert(!JSON.stringify(h.calls.at(-1).input.rounds).includes('第0轮'));assert(h.calls.at(-1).input.context.topics.length);pass('Appended rounds send only new body plus compact theme context');
 const savedGraph=clone(latest.aiResults);latest=h.state['conversation:'+src.key];latest.messages[0].text+='已修改';latest.allMessages=latest.messages;
 answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.reusedRounds,0);assert(answer.requests>1);pass('Editing earlier body invalidates the cached prefix');
 await h.send({type:'ai-save-prompt',prompt:P.default+'\n摘要尽量简洁。'});answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.reusedRounds,0);pass('Changed prompt rebuilds instead of mixing incompatible summaries');
 const failed=harness(makeRecord(10));await failed.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_BATCH_KEY'});let calls=0;
 failed.setResponder(async(url,options,input)=>{if(++calls===2)return new Response('{}',{status:429});return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(input))}}]}))});
 answer=await failed.send({type:'ai-extract',key:src.key});assert(answer.error.includes('429'));assert.equal(failed.calls.length,2);assert.equal(failed.state['conversation:'+src.key].aiDrafts.current.roundSignatures.length,3);assert(!failed.state['conversation:'+src.key].aiResults);pass('Rate limit stops with a checkpoint, never publishes partial output as complete');
 failed.setResponder(async(url,options,input)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(input))}}]})));
 answer=await failed.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.reusedRounds,3);assert.equal(answer.requests,3);pass('Retry resumes from the successful checkpoint instead of resending early rounds');
 const adaptive=harness(makeRecord(7));await adaptive.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_BATCH_KEY'});
 adaptive.setResponder(async(url,options,input)=>input.rounds.length>1?new Response(JSON.stringify({error:{code:'context_length_exceeded',message:'maximum context length'}}),{status:400}):new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(input))}}]})));
 answer=await adaptive.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.requests,8);assert.equal(adaptive.calls[0].input.rounds.length,3);assert(adaptive.calls.slice(1).every(c=>c.input.rounds.length===1));pass('Explicit context failure reduces chunk size and remembers it for the remaining run');
 const output=harness(makeRecord(4));await output.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_BATCH_KEY'});output.setResponder(async(url,options,input)=>new Response(JSON.stringify({choices:[{finish_reason:input.rounds.length>1?'length':'stop',message:{content:input.rounds.length>1?'{}':JSON.stringify(modelOutput(input))}}]})));
 answer=await output.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.requests,5);pass('Output truncation retries a smaller chunk without accepting incomplete JSON');
 const strict=harness(makeRecord(5));await strict.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_BATCH_KEY'});strict.setResponder(async()=>new Response('{}',{status:401}));answer=await strict.send({type:'ai-extract',key:src.key});assert(answer.error.includes('401'));assert.equal(strict.calls.length,1);pass('Authentication failure is not mistaken for context overflow or retried');
 const s=B.settingsSignature(profile,'prompt');assert.equal(s,B.settingsSignature({...profile,inputBudget:10000,batchRounds:2},'prompt'));pass('Changing batching budget does not invalidate finished work');
 const canceled=harness(makeRecord(8));await canceled.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_BATCH_KEY'});let checkpointCalls=0;
 canceled.setResponder(async(url,options,input)=>{if(++checkpointCalls===2)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(input))}}]}))});
 const pending=canceled.send({type:'ai-extract',key:src.key});for(let i=0;i<10&&checkpointCalls<2;i++)await new Promise(r=>setImmediate(r));assert.equal(checkpointCalls,2);await canceled.send({type:'ai-cancel',key:src.key});answer=await pending;assert(answer.error.includes('取消'));assert.equal(canceled.state['conversation:'+src.key].aiDrafts.current.roundSignatures.length,3);pass('Canceling a later chunk preserves already completed checkpoints');
 const changed=h.state['conversation:'+src.key];changed.allMessages.push({id:'alternate-answer',role:'assistant',text:'另一个平台版本的回答'});changed.branches[0].messageIds=['u0','alternate-answer'];
 answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.reusedRounds,0);assert.equal(h.calls.at(-1).input.context.topics.length,0);assert.equal(h.calls.at(-1).input.rounds.length,1);pass('Platform branch changes cannot carry summaries from the old path');
 console.log(`All ${passed} batching checks passed.`);
}
module.exports={makeRecord,modelOutput,harness};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
