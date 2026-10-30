const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const {makeRecord}=require('./test-batches.cjs');
const dir='outputs/topic-atlas-extension/';let passed=0;
const pass=s=>{passed++;console.log('PASS',s);};
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
function page(name){
 const html=fs.readFileSync(dir+name+'.html','utf8'),nodes=new Map(),calls=[],permissions=[],events={};
 for(const match of html.matchAll(/\bid="([^"]+)"/g)){
  const id=match[1];assert(!nodes.has(id),'duplicate ID '+id);
  const classes=new Set(),tag=html.match(new RegExp('<[^>]+\\bid="'+id+'"[^>]*>'))?.[0]||'';nodes.set(id,{id,value:'',checked:false,disabled:false,hidden:/\bhidden\b/.test(tag),textContent:'',innerHTML:'',dataset:{},
   classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c);},contains:c=>classes.has(c),remove:c=>classes.delete(c),add:c=>classes.add(c)},
   listeners:{},setAttribute(k,v){this[k]=v;},addEventListener(k,f){this.listeners[k]=f;},querySelectorAll:()=>[],focus(){},showModal(){this.open=true;},close(){this.open=false;}});
 }
 const record=makeRecord(2),memory={['conversation:'+record.key]:record};
 let profiles,provider='deepseek',prompt='Saved fixture prompt',tasks=[],opened=0,grant=true;
 const document={getElementById(id){assert(nodes.has(id),'missing DOM ID '+id);return nodes.get(id);},querySelectorAll:()=>[],addEventListener(k,f){(events[k]||=[]).push(f);}};
 const c=vm.createContext({document,URL,TextEncoder,TextDecoder,crypto:globalThis.crypto,structuredClone,console,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,confirm:()=>true,
  chrome:{permissions:{request:async p=>{permissions.push(p);return grant;}},runtime:{openOptionsPage:async()=>{opened++;},onMessage:{addListener(){}},sendMessage:async m=>{
   calls.push(structuredClone(m));
   if(m.type==='view-list')return {conversations:Object.values(memory).filter(r=>r?.key).map(r=>({key:r.key,title:r.title,platform:r.platform,updatedAt:r.updatedAt}))};
   if(m.type==='view-get'||m.type==='view-export')return {record:structuredClone(memory['conversation:'+m.key])};
   if(m.type==='view-body'){const r=memory['conversation:'+m.key],parts=m.ids.map(id=>(r.allMessages||r.messages).find(p=>p.id===id)),text=parts.map(p=>p.text).join('\n\n'),offset=m.full?0:m.offset||0,end=m.full?text.length:Math.min(text.length,offset+16384);return {text:text.slice(offset,end),offset,end,total:text.length,...(m.full?{segments:parts}:{})};}
   if(m.type==='ai-get-config')return {provider,profiles:structuredClone(profiles),prompt};
   if(m.type==='ai-save-config'){provider=m.config.provider;profiles[provider]={...m.config,hasKey:m.clearKey?false:!!m.apiKey||profiles[provider].hasKey};return {ok:true};}
   if(m.type==='ai-test')return {model:m.config.model,elapsedMs:35,jsonMode:true};
   if(m.type==='ai-models')return {models:['fixture-model']};
   if(m.type==='ai-save-prompt'){prompt=m.prompt;return {ok:true};}
   if(m.type==='queue-list'||m.type==='queue-summary')return {tasks,settings:{mode:'idle',delay:30},library:{connected:true,granted:true,name:'fixture library'},notice:null};
   if(m.type==='queue-start'){tasks=[{id:'new-task',key:m.key,branchId:m.branchId,state:'queued',createdAt:'2026-10-18T08:00:00Z',processed:0,total:2}];return {ok:true,total:2};}
   return {ok:true};
  }},storage:{local:{get:async k=>k===null?structuredClone(memory):{[k]:memory[k]},set:async v=>Object.assign(memory,v)},onChanged:{addListener:f=>(events.storageChanged||=[]).push(f)}},tabs:{query:async()=>[{id:1,url:record.url}],sendMessage:async()=>({running:true,source:{type:'chatgpt-api'}}),onActivated:{addListener(){}},onUpdated:{addListener(){}}}}});
 for(const name of ['core.js','prompt.js','directions.js','ai.js'])vm.runInContext(fs.readFileSync(dir+name,'utf8'),c,{filename:name});
 profiles=vm.runInContext("Object.fromEntries(Object.entries(AtlasAI.presets).map(([id,p])=>[id,AtlasAI.config({provider:id,baseUrl:id==='custom'?'https://fixture.example/v1':p.baseUrl,model:'fixture-model'})]))",c);
 for(const p of Object.values(profiles))p.hasKey=true;
 for(const [,file] of html.matchAll(/<script src="([^"]+)"><\/script>/g))if(!['core.js','prompt.js','directions.js','ai.js'].includes(file))vm.runInContext(fs.readFileSync(dir+file,'utf8'),c,{filename:file});
 return {html,nodes,c,calls,permissions,events,record,memory,setTasks:v=>tasks=v,setGrant:v=>grant=v,profile:id=>profiles[id],opened:()=>opened};
}
async function run(){
 const p=page('panel');await flush();
 for(const id of ['branch','source','apiTarget','queueSummary','batchProgress','apiDialog','promptDialog','apiSettings','librarySettings'])assert(!p.nodes.has(id));
 assert(p.nodes.has('settingsButton'));assert(p.nodes.has('timelineTab')&&p.nodes.has('graphTab'));pass('Sidebar removes path/count, routine logs and separate settings entries while retaining two views');
 assert.equal(p.nodes.get('aiState').textContent,'AI 归纳 · 未开始');assert(p.nodes.get('status').hidden);pass('Automatic capture and normal startup remain silent with one compact AI state');
 await p.nodes.get('settingsButton').onclick();assert.equal(p.opened(),1);await p.nodes.get('extract').onclick();assert.equal(p.nodes.get('aiState').dataset.state,'queued');assert(p.nodes.get('aiState').textContent.includes('等待中'));assert(!p.nodes.get('aiState').textContent.includes('Token'));pass('Single settings entry opens options; extract still starts the background queue');
 p.setTasks([{key:p.record.key,branchId:'current',state:'running',startedAt:'2026-10-18T08:01:00Z'}]);await vm.runInContext('resumeJob()',p.c);assert(p.nodes.get('aiState').textContent.includes('进行中'));assert(p.nodes.get('aiState').textContent.includes('2026'));pass('Running state displays its actual task timestamp without provider, cost or checkpoint details');
 p.setTasks([{key:p.record.key,branchId:'current',state:'error',createdAt:'2026-10-18T08:00:00Z',error:'Fixture failure'}]);await vm.runInContext('resumeJob()',p.c);assert(p.nodes.get('aiState').textContent.includes('失败'));assert(p.nodes.get('settingsButton').classList.contains('needs-attention'));pass('Failed tasks have a short state and direct users to settings for details');
 const state=vm.createContext({AtlasAI:{analysis:r=>r.analysis}});vm.runInContext(fs.readFileSync(dir+'panel-state.js','utf8'),state);const describe=vm.runInContext('AtlasPanelState.describe',state);
 const r={key:'a',analysis:{stale:false,generatedAt:'2026-10-18T08:03:00Z'}};
 assert.equal(describe(r,'current',[{key:'b',branchId:'current',state:'running'}]).label,'已完成');assert.equal(describe(r,'current',[]).time,r.analysis.generatedAt);r.analysis.stale=true;assert.equal(describe(r,'current',[]).label,'待更新');assert.equal(describe(r,'current',[{key:'a',branchId:'current',state:'interrupted'}]).label,'已暂停');pass('Completion uses the verified result time, stale results stay pending and unrelated tasks do not affect the current record');
 const s=page('settings');await flush();
 for(const id of ['apiForm','promptForm','selectFolder','reauthorize','autoForm','tasks','versions','recordDetails'])assert(s.nodes.has(id));assert(s.nodes.get('recordDetails').textContent.includes(s.record.title));pass('Unified settings initializes model, prompt, library, automation, tasks and source details together');
 const n=s.nodes;assert.equal(n.get('providerInput').value,'deepseek');assert.equal(n.get('promptInput').value,'Saved fixture prompt');
 n.get('providerInput').value='kimi';n.get('providerInput').onchange();assert.equal(n.get('baseUrlInput').value,s.profile('kimi').baseUrl);n.get('apiKeyInput').value='FIXTURE_ONLY_KEY';await n.get('apiForm').onsubmit({preventDefault(){}});assert(n.get('apiDialogStatus').textContent.includes('已保存'));assert.equal(n.get('apiKeyInput').value,'');assert(s.permissions.length);assert(s.calls.some(m=>m.type==='ai-save-config'&&m.config.provider==='kimi'));pass('Migrated API form switches providers, requests endpoint permission, saves settings and clears the key field');
 const before=s.calls.filter(m=>m.type==='ai-save-config').length;await n.get('testConnection').onclick();assert(n.get('apiDialogStatus').textContent.includes('连接成功'));assert.equal(s.calls.filter(m=>m.type==='ai-save-config').length,before);const test=s.calls.find(m=>m.type==='ai-test');assert(!('record' in test));assert(!('messages' in test));pass('Connection test remains a draft-only request and never sends the conversation or saves settings');
 s.setGrant(false);const prior=s.calls.filter(m=>m.type==='ai-test').length;await n.get('testConnection').onclick();assert.equal(s.calls.filter(m=>m.type==='ai-test').length,prior);assert(n.get('apiDialogStatus').textContent.includes('未授权'));s.setGrant(true);pass('Permission rejection prevents a paid connection test after the UI migration');
 await n.get('getModels').onclick();assert(n.get('modelNames').innerHTML.includes('fixture-model'));await n.get('clearApiKey').onclick();assert.equal(s.profile('kimi').hasKey,false);pass('Model discovery and key removal continue working in the unified page');
 n.get('promptInput').value='Changed fixture prompt';await n.get('promptForm').onsubmit({preventDefault(){}});assert(s.calls.some(m=>m.type==='ai-save-prompt'&&m.prompt==='Changed fixture prompt'));n.get('resetPrompt').onclick();assert(n.get('promptInput').value.length>100);pass('Prompt editing, saving and reset remain functional after leaving the sidebar dialog');
 console.log(`All ${passed} unified settings checks passed.`);
}
module.exports={page,flush};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
