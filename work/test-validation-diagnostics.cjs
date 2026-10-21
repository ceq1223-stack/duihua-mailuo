const assert=require('node:assert/strict'),vm=require('node:vm');
const AI=require('../outputs/topic-atlas-extension/ai.js');
const B=require('../outputs/topic-atlas-extension/batch.js');
const {record,valid}=require('./test-ai.cjs');
const {queueHarness}=require('./test-library-queue.cjs');
const {page,flush}=require('./test-unified-settings.cjs');
const {response}=require('./history-fixture.cjs');
const input=AI.prepare(record).input;
let n=0;const pass=name=>{n++;console.log('PASS',name);};
function errorFor(change,options={phase:'分段归纳'}){
 const raw=structuredClone(valid);change(raw);
 try{AI.validate(raw,input,options);assert.fail('Expected rejection');}catch(e){assert(e.diagnostics,e.message);return e;}
}
async function run(){
 let e=errorFor(v=>v.relations[1].evidence=[]);
 assert.equal(e.code,'VALIDATION_RELATION_EVIDENCE_EMPTY');
 assert.equal(e.diagnostics.relationNumber,2);assert.equal(e.diagnostics.roundLabel,'第 3 轮');
 assert.equal(e.diagnostics.field,'evidence');assert.equal(e.diagnostics.actual,'0 条证据');
 assert(e.message.includes('数组为空'));assert(e.diagnostics.nextStep.includes('新建任务'));
 pass('Empty target evidence reports relation, target round, exact cause and next step');
 e=errorFor(v=>v.relations[1].evidence=[structuredClone(v.timeline[0].evidence[0])]);
 assert.equal(e.code,'VALIDATION_RELATION_EVIDENCE_TARGET');assert.equal(e.diagnostics.expected,'第 3 轮');
 assert.equal(e.diagnostics.actual,'第 1 轮');assert(!e.code.startsWith('EVIDENCE_'));
 pass('Evidence only from other rounds is distinct from an empty array and does not enable new repairs');
 for(const [mutate,code] of [
  [v=>v.timeline[0].evidence[0].roundId='missing','EVIDENCE_ROUND'],
  [v=>v.timeline[0].evidence[0].messageId='missing','EVIDENCE_MESSAGE'],
  [v=>v.timeline[0].evidence[0].role='assistant','EVIDENCE_ROLE'],
  [v=>v.timeline[0].evidence[0].quote='PRIVATE_FAKE_QUOTE','EVIDENCE_QUOTE']
 ]){e=errorFor(mutate);assert.equal(e.code,code);assert.equal(e.diagnostics.roundLabel,'第 1 轮');assert(!JSON.stringify(e.diagnostics).includes('PRIVATE_'));}
 pass('Existing four repair codes retain their identity and avoid recording raw quote text');
 for(const [value,code] of [[null,'VALIDATION_STRING_TYPE'],['','VALIDATION_STRING_EMPTY'],['PRIVATE_'.repeat(400),'VALIDATION_STRING_LENGTH']]){
  e=errorFor(v=>v.topics[0].summary=value);assert.equal(e.code,code);assert.equal(e.diagnostics.topicNumber,1);assert(!JSON.stringify(e.diagnostics).includes('PRIVATE_'));
 }
 pass('Missing, empty and oversized fields have distinct safe diagnostics');
 for(const [field,value,code] of [['from','missing','FROM'],['to','missing','TO'],['type','missing','TYPE'],['atRoundId','missing','ROUND'],['inferred',null,'INFERRED']]){
  e=errorFor(v=>v.relations[0][field]=value);assert.equal(e.code,'VALIDATION_RELATION_'+code);assert.equal(e.diagnostics.field,field);
 }
 pass('Relationship reference, type, round and boolean failures identify the actual failing field');
 for(const phase of ['分段归纳','合并结果','发布前检查']){e=errorFor(v=>v.timeline.pop(),{phase});assert.equal(e.code,'VALIDATION_TIMELINE_COVERAGE');assert.equal(e.diagnostics.phase,phase);}
 pass('The same validation records whether failure occurred during inference, merge or publication');
 assert.throws(()=>B.briefs.validate({action:'topic_briefs',topics:[{id:'t',brief:''}]},{topics:[{id:'t'}]}),e=>e.code==='BRIEF_VALUE_INVALID'&&e.diagnostics.topicNumber===1&&e.diagnostics.field==='topics[0].brief');
 assert.throws(()=>B.history.request({action:'select_history',reason:'',topicIds:[],roundIds:[]},[],[],'select_history'),e=>e.code==='HISTORY_REVIEW_REQUIRED'&&e.diagnostics.stage==='历史读取'&&!!e.diagnostics.nextStep);
 pass('Brief completion and history validation use the same diagnostic contract');
 const p=page('settings');await flush();p.c.fixture={...e.diagnostics,relationNumber:2,reason:'<img src=x>',actual:'<script>',nextStep:'检查后再试'};
 const html=vm.runInContext('diagnosticDetails(fixture)',p.c);assert(html.includes('建议操作'));assert(html.includes('关系序号'));assert(html.includes('&lt;img'));assert(!html.includes('<script>'));
 pass('Settings display field, location, cause and suggested action with escaping');
 const q=queueHarness({['conversation:'+record.key]:structuredClone(record)});
 await q.send({type:'ai-save-config',config:{provider:'openai',model:'fixture',rememberKey:true,reuseResults:false,inputBudget:12000,batchRounds:6},apiKey:'PRIVATE_KEY'});
 let calls=0;q.setResponder(async()=>{calls++;const bad=structuredClone(valid);bad.relations[1].evidence=[];return response(bad);});
 await q.send({type:'queue-start',key:record.key});await q.pump();
 const task=q.state['atlas:queue'][0];assert.equal(task.state,'error');assert.equal(calls,1);
 assert.equal(task.errorDiagnostics.code,'VALIDATION_RELATION_EVIDENCE_EMPTY');assert.equal(task.errorDiagnostics.phase,'分段归纳');assert.equal(task.errorDiagnostics.relationNumber,2);
 assert(!JSON.stringify(task.errorDiagnostics).includes('PRIVATE_KEY'));assert(!q.state['conversation:'+record.key].aiResults?.current);
 pass('Queue persists precise validation diagnostics without adding a retry or accepting the invalid result');
 const unknown=AI.describeError(new Error('本地处理未完成'));
 assert.equal(unknown.code,'TASK_ERROR');assert.equal(unknown.diagnostics.stage,'后台任务');assert(unknown.diagnostics.nextStep);
 const existing=AI.describeError(Object.assign(new Error('估算超过预算'),{code:'INPUT_BUDGET',diagnostics:{stage:'输入规划',code:'INPUT_BUDGET',estimatedInput:20000}}));
 assert.equal(existing.diagnostics.estimatedInput,20000);assert.equal(existing.diagnostics.reason,'估算超过预算');assert(existing.diagnostics.nextStep);
 pass('Legacy classified errors keep metadata while unclassified failures get a fallback diagnostic');
 console.log(`All ${n} validation diagnostic checks passed.`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
