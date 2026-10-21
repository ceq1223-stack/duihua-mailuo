const assert=require('node:assert/strict');
const A=require('../outputs/topic-atlas-extension/core.js'),AI=require('../outputs/topic-atlas-extension/ai.js'),B=require('../outputs/topic-atlas-extension/batch.js'),P=require('../outputs/topic-atlas-extension/prompt.js');
const {makeRecord,modelOutput,harness}=require('./test-batches.cjs');
const {queueHarness}=require('./test-library-queue.cjs');
const {response}=require('./history-fixture.cjs');
let n=0;const pass=name=>{n++;console.log('PASS',name);};
const profile=AI.config({provider:'openai',model:'fixture',rememberKey:true,inputBudget:12000,batchRounds:6});
function rawFixture(){
 const entries=[
 ['u',{author:{role:'user'},content:{content_type:'text',parts:['请生成代码，保留命令示例。']}}],
 ['thought',{author:{role:'assistant'},channel:null,content:{content_type:'thoughts',text:'PRIVATE_THOUGHT'}}],
 ['progress',{author:{role:'assistant'},channel:'commentary',content:{content_type:'text',parts:['PRIVATE_PROGRESS']}}],
 ['call',{author:{role:'assistant'},channel:null,recipient:'container.exec',content:{content_type:'code',text:'PRIVATE_COMMAND'}}],
 ['web',{author:{role:'assistant'},channel:null,recipient:'web.run',content:{content_type:'text',parts:['PRIVATE_WEB_REQUEST']}}],
 ['unknownTool',{author:{role:'assistant'},recipient:'plugin.some_new_tool',content:{content_type:'text',parts:['PRIVATE_UNKNOWN_CALL']}}],
 ['output',{author:{role:'tool'},content:{content_type:'execution_output',text:'PRIVATE_OUTPUT'}}],
 ['final',{author:{role:'assistant'},channel:'final',recipient:'all',end_turn:true,status:'finished_successfully',content:{content_type:'text',parts:['正式答案：\n```bash\nrg --files\n```\n这个示例提到了思考、analysis 和 container.exec。']}}]
 ];
 const mapping={};entries.forEach(([id,message],i)=>{message.id=id;mapping[id]={parent:i?entries[i-1][0]:null,children:i+1<entries.length?[entries[i+1][0]]:[],message};});
 return {mapping,current_node:'final'};
}
function recordFor(raw=rawFixture()){return {...makeRecord(1),...A.normalizeChatGPT(raw)};}
async function run(){
 const raw=rawFixture(),clean=recordFor(raw);
 assert.deepEqual(clean.messages.map(m=>m.nativeId),['u','final']);assert.equal(clean.source.filterVersion,A.answerFilterVersion);assert.equal(clean.source.excludedByRule['tool-recipient'],3);
 assert.equal(clean.source.excludedByRule.commentary,1);assert.equal(clean.source.excludedByRule['internal-content'],1);assert(!JSON.stringify(clean).includes('PRIVATE_'));
 pass('Real observed role/channel/recipient/type combinations keep user and final while removing internal nodes');
 assert.equal(A.turns(clean.messages).length,1);assert.equal(clean.branches[0].messageIds.length,2);assert.equal(clean.source.completeness,'returned-tree');
 pass('Removing intervening thought and tool nodes preserves the parent path and round pairing');
 const text=AI.prepare(clean).input.rounds[0].messages.find(m=>m.role==='assistant').text;assert(text.includes('rg --files'));assert(text.includes('analysis 和 container.exec'));
 pass('Code fences and words about thinking or tools inside a final answer are not text-filtered');
 const finalCode=rawFixture();finalCode.mapping.final.message.content={content_type:'code',language:'bash',text:'echo legitimate_user_requested_code'};
 assert(AI.prepare(recordFor(finalCode)).input.rounds[0].messages.some(m=>m.text.includes('legitimate_user_requested_code')));
 pass('A code-type message directed to the user remains a valid formal answer');
 const legacyStyle=rawFixture();delete legacyStyle.mapping.final.message.channel;delete legacyStyle.mapping.final.message.recipient;delete legacyStyle.mapping.final.message.end_turn;
 assert.equal(A.normalizeChatGPT(legacyStyle).messages.length,2);
 pass('A plain answer without channel or recipient markers is retained rather than assumed internal');
 const parts=rawFixture();parts.mapping.final.message.content={content_type:'multimodal_text',parts:[{content_type:'thoughts',text:'PRIVATE_PART_THOUGHT'},{type:'tool_call',text:'PRIVATE_PART_CALL'},{type:'text',text:'保留答案正文'},{type:'code',text:'print(42)'}]};
 const mixed=recordFor(parts);assert(!JSON.stringify(mixed).includes('PRIVATE_PART_'));assert(mixed.messages[1].text.includes('保留答案正文'));assert(mixed.messages[1].text.includes('print(42)'));assert.equal(mixed.source.excludedParts,2);
 pass('Marked internal content blocks are removed without dropping adjacent answer text or code');
 const userParts=rawFixture();userParts.mapping.u.message.content={content_type:'text',parts:['请解释以下代码',{type:'code',text:'container.exec example'},{type:'thoughts',text:'这是用户引用的文本'}]};
 assert(A.normalizeChatGPT(userParts).messages[0].text.includes('这是用户引用的文本'));
 pass('User-provided code and quoted material are preserved');
 for(const message of [{role:'assistant',channel:'analysis'},{role:'assistant',toolCall:true},{role:'assistant',tool_calls:[{}]},{role:'assistant',function_call:{}},{role:'assistant',metadata:{is_tool_call:true}},{role:'assistant',metadata:{is_internal:true}}])assert(A.excludedMessage(message));
 pass('Explicit analysis, internal and alternate tool-call markers are rejected by the shared rule');
 const guarded=structuredClone(clean),noise=[{id:'noise1',role:'assistant',channel:'commentary',text:'PRIVATE_OLD_PROGRESS'},{id:'noise2',role:'assistant',recipient:'container.exec',text:'PRIVATE_OLD_TOOL'},{id:'noise3',role:'assistant',contentType:'thoughts',text:'PRIVATE_OLD_THOUGHT'}];
 guarded.allMessages.splice(1,0,...noise);guarded.messages=guarded.allMessages;guarded.branches[0].messageIds=guarded.messages.map(m=>m.id);
 assert(!JSON.stringify(AI.prepare(guarded).input).includes('PRIVATE_'));
 pass('Request preparation repeats filtering even if a marked internal message exists in stored data');
 const combined=A.answerMessages([{role:'assistant',channel:'commentary',segments:[{id:'c',role:'assistant',channel:'commentary',text:'PRIVATE_PROGRESS'},{id:'f',role:'assistant',channel:'final',text:'保留最终答案'}]}]);
 assert.equal(combined[0].id,'f');assert.equal(combined[0].text,'保留最终答案');
 pass('Merged fragments are filtered individually when the first fragment is only commentary');
 const legacy=structuredClone(guarded);delete legacy.source.filterVersion;
 assert.throws(()=>AI.prepare(legacy),e=>e.code==='SOURCE_REFRESH_REQUIRED'&&e.message.includes('刷新'));
 pass('Unmarked legacy ChatGPT sources require recapture rather than guessing which text to remove');
 const h=harness(clean);await h.send({type:'ai-save-config',config:profile,apiKey:'FIXTURE_ONLY_KEY'});const result=await h.send({type:'ai-extract',key:clean.key});assert(result.ok,result.error);assert.equal(h.calls.length,1);assert(!JSON.stringify(h.calls[0].input).includes('PRIVATE_'));assert(h.calls[0].input.rounds[0].messages[1].text.includes('rg --files'));
 pass('The actual mocked API request includes only retained messages and legitimate answer code');
 const blocked=harness(legacy);await blocked.send({type:'ai-save-config',config:profile,apiKey:'FIXTURE_ONLY_KEY'});const rejected=await blocked.send({type:'ai-extract',key:legacy.key});assert(rejected.error.includes('刷新'));assert.equal(blocked.calls.length+blocked.historyCalls.length+blocked.briefCalls.length,0);
 pass('Legacy-source rejection sends zero graph, history or brief model requests');
 const original=AI.prepare(guarded),sig=B.settingsSignature(profile,P.default),old=structuredClone(original.input);
 old.rounds[0].messages.splice(1,0,{messageId:'old-progress',role:'assistant',text:'PRIVATE_OLD_PROGRESS',nonText:false});
 const oldEntry={settingsSignature:sig,fingerprint:'old-policy-fingerprint',roundSignatures:B.roundSignatures(old),result:modelOutput(old),sourceMessages:old.rounds.flatMap(r=>r.messages.map(m=>[m.messageId,A.hash(JSON.stringify([m.role,m.text]))]))};
 clean.aiResults={current:oldEntry};assert.equal(B.resume(clean,'current',AI.prepare(clean).input,sig).processed,0);
 pass('Completed summaries based on removed messages are not reused as compatible progress');
 clean.source.excludedMessageIds.push('old-progress');assert(AI.displayAnalysis(clean,'current'));assert.equal(AI.displayAnalysis(clean,'current').stale,true);
 pass('A published old graph can remain visibly stale when known excluded messages were removed');
 const q=queueHarness({['conversation:'+clean.key]:clean});await q.send({type:'ai-save-config',config:profile,apiKey:'FIXTURE_ONLY_KEY'});
 const prepared=AI.prepare(clean),oldTask={id:'old-task',key:clean.key,title:clean.title,branchId:'current',fingerprint:prepared.fingerprint,profile,prompt:P.default,record:structuredClone(clean),state:'queued',processed:0,total:1,requests:0};delete oldTask.record.source.filterVersion;
 q.state['atlas:queue']=[oldTask];const started=await q.send({type:'queue-start',key:clean.key});assert.notEqual(started.id,'old-task');
 pass('An old-policy queued task cannot absorb a manual start using freshly collected source');
 console.log(`All ${n} answer filter checks passed.`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
