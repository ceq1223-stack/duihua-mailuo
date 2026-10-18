const assert=require('assert/strict'),A=require('../outputs/topic-atlas-extension/core.js'),AI=require('../outputs/topic-atlas-extension/ai.js'),B=require('../outputs/topic-atlas-extension/batch.js');
const {record,valid}=require('./test-ai.cjs'),{makeRecord,modelOutput,harness}=require('./test-batches.cjs');
const clone=v=>structuredClone(v);let passed=0;const pass=s=>{passed++;console.log('PASS',s)};
async function run(){
 const input=AI.prepare(record).input;
 const spaced=clone(input);spaced.rounds[0].messages[0].text='先设计\r\n主题中心架构';
 const normalized=AI.validate(valid,spaced);assert.equal(normalized.timeline[0].evidence[0].quote,'先设计\r\n主题中心架构');assert(spaced.rounds[0].messages[0].text.includes(normalized.timeline[0].evidence[0].quote));pass('Chinese wrapping is resolved to the exact original substring');
 assert.equal(AI.sourceQuote('Please keep\n\tall original  message IDs.','Please keep all original message IDs.'),'Please keep\n\tall original  message IDs.');pass('Whitespace differences preserve original source formatting in stored evidence');
 assert.equal(AI.sourceQuote('原文说明：“保持消息引用不变”。','原文说明："保持消息引用不变"。'),'原文说明：“保持消息引用不变”。');pass('Typographic quotes resolve back to original punctuation');
 assert.equal(AI.sourceQuote('保持原始\u200b消息引用不变','保持原始消息引用不变'),'保持原始\u200b消息引用不变');pass('Invisible formatting characters do not break source matching');
 for(const [source,quote] of [['We cannot collect all messages.','We can not collect all messages.'],['可以不采集所有消息','可以采集所有消息'],['处理了80%的内容','处理了90%的内容'],['前面的真实正文和后面的真实正文','前面的真实正文……后面的真实正文'],['保持原始消息引用不变','自行编造的摘要内容']])assert.equal(AI.sourceQuote(source,quote),null);pass('Changed words, numbers, negation, inserted ellipsis and fabricated text are rejected');
 const aliases=clone(valid),map=new Map(input.rounds.map(r=>[r.roundId,r.ref]));
 for(const t of aliases.topics)t.roundIds=t.roundIds.map(id=>map.get(id));
 for(const row of aliases.timeline){row.roundId=map.get(row.roundId);for(const ev of row.evidence){const r=input.rounds.find(r=>r.roundId===ev.roundId);ev.roundId=r.ref;ev.messageId=r.messages.find(m=>m.messageId===ev.messageId).ref}}
 for(const edge of aliases.relations){edge.atRoundId=map.get(edge.atRoundId);for(const ev of edge.evidence){const r=input.rounds.find(r=>r.roundId===ev.roundId);ev.roundId=r.ref;ev.messageId=r.messages.find(m=>m.messageId===ev.messageId).ref}}
 assert.deepEqual(AI.validate(aliases,input),valid);pass('Explicit short round/message references canonicalize to real local IDs');
 const wrong=clone(aliases);wrong.timeline[0].evidence[0].messageId='R1M2';assert.throws(()=>AI.validate(wrong,input),error=>error.code==='EVIDENCE_ROLE'&&error.message.includes('第 1 轮'));pass('Known aliases never bypass source-role validation');
 const unknown=clone(valid);unknown.timeline[0].evidence[0].messageId='made-up';assert.throws(()=>AI.validate(unknown,input),error=>error.code==='EVIDENCE_MESSAGE'&&error.message.includes('第 1 轮')&&!error.message.includes('先设计'));pass('Errors identify round and failure category without leaking source text');
 const badQuote=clone(valid);badQuote.timeline[1].evidence[0].quote='这是改写的摘要';assert.throws(()=>AI.validate(badQuote,input),error=>error.code==='EVIDENCE_QUOTE'&&error.message.includes('第 2 轮'));pass('Unverifiable quote errors are distinct from invalid message IDs');
 const oldHashes=input.rounds.map(r=>[r.roundId,A.hash(JSON.stringify([r.messages.map(({messageId,role,text,nonText})=>({messageId,role,text,nonText})),input.manualAnnotations.find(a=>a.roundId===r.roundId)||null]))]);
 assert.deepEqual(B.roundSignatures(input),oldHashes);for(const r of input.rounds)for(const m of r.messages)for(const quote of m.quoteCandidates)assert(m.text.includes(quote));pass('Safe quotation candidates do not invalidate v0.5.0 checkpoint fingerprints');
 const src=makeRecord(8),h=harness(src),config={provider:'deepseek',model:'mock',batchRounds:4,inputBudget:16000,maxTokens:12000};
 await h.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_EVIDENCE_KEY'});let calls=0;
 h.setResponder(async(url,options,input)=>{const output=modelOutput(input);if(++calls===2)output.timeline[0].evidence[0].quote='编造的摘录';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}))});
 let answer=await h.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.requests,3);assert(h.calls[2].input.citationRepair);assert.equal(h.calls[2].input.rounds[0].ref,'R5');pass('One citation correction retries only the failed segment and then publishes a verified graph');
 const persistent=harness(src);await persistent.send({type:'ai-save-config',config,apiKey:'TEST_ONLY_EVIDENCE_KEY'});let attempts=0;
 persistent.setResponder(async(url,options,input)=>{const output=modelOutput(input);if(++attempts>1)output.timeline[0].evidence[0].quote='始终捏造的摘录';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}))});
 answer=await persistent.send({type:'ai-extract',key:src.key});assert(answer.error.includes('第 5 轮'));assert.equal(persistent.calls.length,3);assert.equal(persistent.state['conversation:'+src.key].aiDrafts.current.roundSignatures.length,4);assert(!persistent.state['conversation:'+src.key].aiResults);pass('Persistent bad quotations stop after one correction and preserve four completed rounds');
 persistent.setResponder(async(url,options,input)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(input))}}]})));
 answer=await persistent.send({type:'ai-extract',key:src.key});assert(answer.ok,answer.error);assert.equal(answer.reusedRounds,4);assert.equal(answer.requests,1);pass('The next click resumes at round five without resending the four verified rounds');
 console.log(`All ${passed} evidence checks passed.`);
}
run().catch(e=>{console.error(e);process.exitCode=1});
