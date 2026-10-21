const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const Atlas=require('../outputs/topic-atlas-extension/core.js'),AI=require('../outputs/topic-atlas-extension/ai.js');
const {makeRecord,modelOutput}=require('./test-batches.cjs');const {page,flush}=require('./test-unified-settings.cjs');
let passed=0;const pass=s=>{passed++;console.log('PASS',s);};
function publication(record,date='2026-10-18T08:00:00Z'){
 const {input,fingerprint}=AI.prepare(record,'current');return {fingerprint,generatedAt:date,result:AI.validate(modelOutput(input),input),
 sourceMessages:input.rounds.flatMap(r=>r.messages.map(m=>[m.messageId,Atlas.hash(JSON.stringify([m.role,m.text]))])),roundSignatures:input.rounds.map(r=>[r.roundId,'fixture'])};
}
async function run(){
 const old=makeRecord(2),entry=publication(old),live=makeRecord(3);live.aiResults={current:entry};
 assert(AI.analysis(live,'current').stale);assert.equal(AI.displayAnalysis(live,'current').result.timeline.length,2);pass('Appending new rounds retains the previous complete graph while freshness stays stale');
 live.aiDrafts={current:publication(live,'2026-10-18T08:01:00Z')};assert.equal(AI.displayAnalysis(live,'current').result.timeline.length,2);pass('Newer draft checkpoints cannot replace the published graph');
 live.aiResults.current=publication(live,'2026-10-18T08:02:00Z');assert(!AI.displayAnalysis(live,'current').stale);assert.equal(AI.displayAnalysis(live,'current').result.timeline.length,3);pass('A validated completed publication replaces the old graph');
 const later=makeRecord(4);later.aiResults={current:entry};later.aiHistory=[{branchId:'current',entry:live.aiResults.current,complete:true}];assert.equal(AI.displayAnalysis(later,'current').result.timeline.length,3);assert(AI.displayAnalysis(later,'current').stale);pass('When messages arrive during a job, its completed snapshot can publish while the remaining messages await the next job');
 later.aiHistory[0].complete=false;assert.equal(AI.displayAnalysis(later,'current').result.timeline.length,2);delete later.aiHistory[0].complete;assert.equal(AI.displayAnalysis(later,'current').result.timeline.length,2);pass('Partial or legacy-unknown history is never mistaken for a finished replacement');
 const alternate=makeRecord(3);alternate.aiResults={current:entry};alternate.allMessages.find(m=>m.id===entry.sourceMessages[1][0]).id='other-answer';alternate.branches[0].messageIds[1]='other-answer';assert.equal(AI.displayAnalysis(alternate,'current'),null);pass('Reusing the current alias for a different answer does not display the previous branch graph');
 const edit=makeRecord(3);edit.aiResults={current:entry};edit.allMessages[0].text+=' edited';assert.equal(AI.displayAnalysis(edit,'current'),null);pass('Changed source text cannot inherit old quotations as if they matched');
 const noOld=makeRecord(3);noOld.aiDrafts={current:publication(noOld)};assert.equal(AI.displayAnalysis(noOld,'current'),null);pass('A first-time conversation does not borrow a draft or another conversation graph');
 const p=page('panel');await flush();p.c.retained=structuredClone(entry);
 vm.runInContext("records[0].aiResults={current:retained};render();setView('graph');",p.c);
 const graph=p.nodes.get('graph'),firstHTML=graph.innerHTML;assert(firstHTML.includes('graph-stage'));assert(firstHTML.includes(entry.result.topics[0].name));
 p.c.appended=makeRecord(3);vm.runInContext('records[0]={...appended,aiResults:{current:retained}};render();',p.c);assert.equal(graph.innerHTML,firstHTML);pass('Actual panel rendering keeps the complete graph DOM through newly captured messages');
 p.memory['conversation:'+p.record.key]=structuredClone(vm.runInContext('rawRecord()',p.c));
 p.setTasks([{key:p.record.key,branchId:'current',state:'running'}]);await vm.runInContext('resumeJob()',p.c);assert.equal(graph.innerHTML,firstHTML);assert(p.nodes.get('aiState').textContent.includes('进行中'));
 p.setTasks([{key:p.record.key,branchId:'current',state:'error'}]);await vm.runInContext('resumeJob()',p.c);assert.equal(graph.innerHTML,firstHTML);pass('Running and failed task states leave the old graph available');
 vm.runInContext('render();',p.c);vm.runInContext("locateTopic(retained.result.topics[0].id)",p.c);assert(graph.innerHTML.includes('主题详细摘要 · AI 归纳'));assert(graph.innerHTML.includes('data-round="'+entry.result.topics[0].roundIds[0]+'"'));pass('A retained graph topic opens its original summary and linked round titles');
 const next=publication(makeRecord(3),'2026-10-18T08:04:00Z');next.result.topics[0].name='新版主题';p.c.next=next;
 p.c.document.scrollingElement={scrollTop:218};vm.runInContext("records[0].aiResults.current=next;render();",p.c);assert(graph.innerHTML.includes('新版主题'));assert.equal(p.c.document.scrollingElement.scrollTop,218);pass('Completed replacement switches synchronously and preserves the current scroll position');
 vm.runInContext("records=[];selectedKey='';render();",p.c);assert(!graph.innerHTML.includes('新版主题'));assert(!graph.innerHTML.includes('主题详细摘要 · AI 归纳'));pass('Changing to an empty conversation clears the old graph and its detail');
 p.c.saved=makeRecord(3);vm.runInContext("records=[{...saved,aiResults:{current:next}}];selectedKey=saved.key;render();",p.c);assert(graph.innerHTML.includes('新版主题'));pass('Returning from an empty conversation restores the correct graph instead of leaving a stale render cache');
 console.log(`All ${passed} retained graph checks passed.`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
