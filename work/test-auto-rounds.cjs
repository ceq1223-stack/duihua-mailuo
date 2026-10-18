const A=require('../outputs/topic-atlas-extension/core.js'),assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const m=(id,role,text)=>({id,nativeId:id,role,text});
const raw=[m('u1','user','用户正文'),m('u-context','user','用户追加文本'),{...m('a-note','assistant','先给出要点'),channel:'commentary'},{...m('a-final','assistant','最终答案'),channel:'final'},m('u2','user','下一次提问'),m('a2','assistant','下一次回复')];
const turns=A.turns(raw);assert.equal(turns.length,2);assert.equal(turns[0].user.segments.length,2);assert.equal(turns[0].assistants.length,1);assert.equal(turns[0].assistants[0].segments.length,2);assert(turns[0].assistants[0].text.includes('最终答案'));
console.log('PASS consecutive user and assistant fragments become exactly one user / AI node per round');
const mapping={root:{parent:null,children:['u']},u:{parent:'root',children:['ctx'],message:{...m('u','user',''),author:{role:'user'},content:{content_type:'text',parts:['问题']}}},ctx:{parent:'u',children:['analysis'],message:{id:'ctx',author:{role:'user'},content:{content_type:'text',parts:['隐藏背景']},metadata:{is_user_system_message:true}}},analysis:{parent:'ctx',children:['a'],message:{id:'analysis',author:{role:'assistant'},channel:'analysis',content:{content_type:'text',parts:['不应展示的内部分析']}}},a:{parent:'analysis',children:[],message:{id:'a',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['答案']}}}};
const normalized=A.normalizeChatGPT({mapping,current_node:'a'});assert.equal(normalized.messages.length,2);assert.equal(A.turns(normalized.messages).length,1);assert(!JSON.stringify(normalized).includes('不应展示的内部分析'));console.log('PASS hidden context and analysis are omitted without breaking the parent chain');
async function run(){
 const timers=[],intervals=[],listeners=[],changes=[],saves=[],clock={now:()=>Date.now()},settings={};
 const location={href:'https://chatgpt.com/c/one'};
 const context={Atlas:A,location,document:{documentElement:{},addEventListener:()=>{}},Date:clock,MutationObserver:class{observe(){}},setTimeout:(f,ms)=>{const t={f,ms,active:true};timers.push(t);return t},clearTimeout:t=>{if(t)t.active=false},setInterval:f=>{intervals.push(f)},chrome:{storage:{local:{get:async()=>settings},onChanged:{addListener:f=>changes.push(f)}},runtime:{getManifest:()=>({version:'0.3.0'}),onMessage:{addListener:f=>listeners.push(f)},sendMessage:async msg=>{if(msg.type==='read-structured'){saves.push(location.href);return {count:2,source:{type:'chatgpt-api'}}}return {ok:true}}}}};
 vm.runInNewContext(fs.readFileSync('outputs/topic-atlas-extension/automatic.js','utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 const tick=async()=>{const t=timers.find(t=>t.active);if(t){t.active=false;await t.f();await new Promise(resolve=>setImmediate(resolve))}};
 await tick();assert.deepEqual(saves,['https://chatgpt.com/c/one']);console.log('PASS first visit auto-captures without any start message or button');
 location.href='https://chatgpt.com/c/two';intervals[0]();await tick();assert.equal(saves[1],location.href);console.log('PASS single-page navigation automatically follows the new conversation');
 listeners[0]({type:'auto-setting',enabled:false},{},()=>{});location.href='https://chatgpt.com/c/three';intervals[0]();await tick();assert.equal(saves.length,2);console.log('PASS trusted worker pause notification prevents capture on navigation');
 listeners[0]({type:'auto-setting',enabled:true},{},()=>{});await tick();assert.equal(saves.length,3);console.log('PASS trusted worker resume notification restarts current page capture');
 const panel=fs.readFileSync('outputs/topic-atlas-extension/panel.html','utf8');assert(!panel.includes('id="capture"'));assert(panel.includes('id="automatic"'));console.log('PASS capture button removed; automatic control present');
}
run().catch(e=>{console.error(e);process.exitCode=1});
