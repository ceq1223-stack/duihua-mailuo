const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const dir='outputs/topic-atlas-extension/';
const A=require('../'+dir+'core.js');
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS',name)}
const m=(id,role,text)=>({id,role,text,nativeId:id});
test('Only supported stable conversation routes',()=>{
 assert(A.conversation('https://chatgpt.com/c/abc').key);
 assert(A.conversation('https://chatgpt.com/g/g-p/project/c/abc').key);
 assert(A.conversation('https://gemini.google.com/app/abc').key);
 assert(A.conversation('https://gemini.google.com/u/1/app/abc').key);
 assert(A.conversation('https://chatgpt.com/').draft);
 assert.equal(A.conversation('https://chatgpt.com.evil.example/c/abc'),null);
 assert.equal(A.conversation('http://gemini.google.com/app/a'),null);
});
test('Streaming updates retain original first seen and do not duplicate',()=>{
 const a=A.merge(null,[m('u','user','question'),m('a','assistant','start')],'first');
 const b=A.merge({messages:a},[m('u','user','question'),m('a','assistant','start complete')],'last');
 assert.equal(b.length,2);assert.equal(b[1].text,'start complete');assert.equal(b[1].firstSeenAt,'first');assert.equal(b[1].lastSeenAt,'last');
});
test('Lazy-loaded earlier history is inserted before known messages',()=>{
 const old=A.merge(null,[m('u2','user','second'),m('a2','assistant','answer2')],'a');
 const result=A.merge({messages:old},[m('u1','user','first'),m('a1','assistant','answer1'),m('u2','user','second')],'b');
 assert.deepEqual(result.map(m=>m.id),['u1','a1','u2','a2']);
});
test('Partial snapshots retain existing history and append later turns',()=>{
 const old=A.merge(null,[m('1','user','q1'),m('2','assistant','a1'),m('3','user','q2')],'a');
 const result=A.merge({messages:old},[m('3','user','q2'),m('4','assistant','a2')],'b');
 assert.deepEqual(result.map(m=>m.id),['1','2','3','4']);
});
test('Fallback IDs after reload preserve annotation identity by exact text',()=>{
 const old=A.merge(null,[m('old','user','same')],'a');
 const result=A.merge({messages:old},[m('new','user','same')],'b');
 assert.equal(result.length,1);assert.equal(result[0].id,'old');
});
test('Repeated identical prompts remain distinct',()=>{
 const result=A.merge(null,[m('q1','user','same'),m('a1','assistant','yes'),m('q2','user','same')],'a');
 assert.equal(A.turns(result).length,2);
});
test('Grouping, branch and return annotations',()=>{
 const record={messages:[m('q1','user','a'),m('a1','assistant','answer a'),m('q2','user','b'),m('a2','assistant','answer b'),m('q3','user','a again')],annotations:{q1:{topic:'架构'},q2:{topic:'竞品',relation:'branch'},q3:{topic:'架构'}}};
 const g=A.graph(record);assert.equal(g.nodes.length,2);assert.equal(g.nodes[0].turnIds.length,2);assert.deepEqual(g.edges.map(e=>e.type),['branch','return']);
});
test('Missing user is explicit, never fabricated',()=>{const t=A.turns([m('a','assistant','answer')])[0];assert.equal(t.user,null);assert.equal(t.assistants.length,1)});
test('Manifest scope and all scripts parse',()=>{
 const manifest=JSON.parse(fs.readFileSync(dir+'manifest.json'));assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,['storage','sidePanel','activeTab','scripting','alarms','unlimitedStorage']);
 assert.equal(manifest.host_permissions.length,3);assert(!manifest.permissions.includes('history'));
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js')))new vm.Script(fs.readFileSync(dir+file,'utf8'));
 for(const file of ['background.js','panel.html',...manifest.content_scripts[0].js])assert(fs.existsSync(dir+file));
});
async function workerTests(){
 const state={},listeners=[];
 const context={URL,console,Atlas:A,AtlasQueue:{remove:async()=>{}},importScripts:()=>{},chrome:{sidePanel:{setPanelBehavior:async()=>{}},runtime:{onMessage:{addListener:f=>listeners.push(f)}},storage:{local:{get:async key=>({[key]:state[key]}),set:async o=>Object.assign(state,o),remove:async key=>delete state[key]}}}};
 vm.runInNewContext(fs.readFileSync(dir+'trust.js','utf8')+'\n'+fs.readFileSync(dir+'background.js','utf8'),context);
 const send=(message,sender={})=>new Promise(resolve=>listeners[0](message,sender,resolve));
 const conversation=A.conversation('https://chatgpt.com/c/test');
 let result=await send({type:'capture',conversation,messages:[m('u','user','question')],title:'test'},{tab:{url:conversation.url}});assert(result.ok);
 result=await send({type:'annotate',key:conversation.key,turnId:'u',topic:'主题',summary:'总结',relation:'branch'});assert(result.ok);
 await send({type:'capture',conversation,messages:[m('u','user','question'),m('a','assistant','answer')]},{tab:{url:conversation.url}});
 const saved=state['conversation:'+conversation.key];assert.equal(saved.annotations.u.topic,'主题');assert.equal(saved.messages.length,2);
 result=await send({type:'capture',conversation,messages:[]},{tab:{url:'https://evil.example/'}});assert(result.error);
 result=await send({type:'annotate',key:conversation.key,turnId:'u',topic:'hijack'},{tab:{url:conversation.url}});assert(result.error);
 console.log('PASS worker capture, persistence, annotation retention, sender validation');
 await send({type:'delete',key:conversation.key});assert(!state['conversation:'+conversation.key]);console.log('PASS worker delete');
 console.log(`All ${tests+2} checks passed.`);
}
workerTests().catch(e=>{console.error(e);process.exitCode=1});
