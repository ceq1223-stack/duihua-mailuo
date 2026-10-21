/* Persisted snapshot queue: one complete API segment per worker dispatch. */
const AtlasQueue = (() => {
  const queueKey='atlas:queue', settingsKey='atlas:organize';
  let serial=Promise.resolve(), pumping=false, ready, wakeTimer, wakeAt=Infinity;
  function lock(fn) { const p=serial.then(fn); serial=p.catch(()=>{}); return p; }
  const get=async key=>(await chrome.storage.local.get(key))[key];
  const tasks=async()=>await get(queueKey)||[];
  const settings=async()=>({mode:'idle',delay:30,...await get(settingsKey)});
  const retarget=(entry,branchId)=>({...entry,result:{...entry.result,branchId}});
  // Execution identity includes budgets and batching settings. Progress identity
  // deliberately excludes those knobs so compatible completed work can be reused.
  const executionSignature=task=>Atlas.hash(JSON.stringify([AtlasAI.config(task.profile),task.prompt]));
  async function store(list) { await chrome.storage.local.set({[queueKey]:list}); }
  async function archive(record,list,reason) { return AtlasLibrary.persist(record,list.filter(t=>t.key===record.key),reason); }
  function fingerprint(record,branch='current') { try { return AtlasAI.signature(record,branch); } catch { return null; } }
  function completed(record) {
    const last=record.messages?.at(-1);
    // Unknown completion is not silently interpreted as a finished response.
    return last?.role==='assistant' && ['finished_successfully','finished'].includes(last.status);
  }
  async function wake(when=Date.now()+500) {
    if (!chrome.alarms) return;
    const target=Math.max(Date.now()+200,when);
    // Timer gives responsive continuation while alive; alarm survives worker suspension.
    if(target<wakeAt){clearTimeout(wakeTimer);wakeAt=target;wakeTimer=setTimeout(()=>{wakeAt=Infinity;pump().catch(console.error);},target-Date.now());}
    await chrome.alarms.create('atlas-queue',{when:target});
  }
  async function init() {
    if (!ready) ready=lock(async()=>{
      const list=await tasks(); let changed=false;
      for(const t of list) if(['running','queued'].includes(t.state)) {t.state='interrupted';t.error='浏览器或扩展中断。已保留分段进度，请点击续做。';changed=true;}
      if(changed) await store(list);
    });
    return ready;
  }
  async function create(record,branchId,manual,list) {
    const spec=await AtlasAPI.specification(), frozen=structuredClone(record), prepared=AtlasAI.prepare(frozen,branchId);
    if(!manual)spec.profile.reuseResults=true;
    if(!spec.profile.reuseResults){frozen.aiResults={};frozen.aiDrafts={};}
    const sig=AtlasBatch.settingsSignature(spec.profile,spec.prompt);
    // Pick the longest compatible prefix from this branch's verified versions.
    let best=AtlasBatch.resume(frozen,branchId,prepared.input,sig,spec.profile.reuseResults);
    for(const h of record.aiHistory||[]) if(spec.profile.reuseResults) {
      const entry=retarget(h.entry,branchId), candidate=AtlasBatch.resume({...frozen,aiResults:{[branchId]:entry},aiDrafts:{}},branchId,prepared.input,sig,spec.profile.reuseResults);
      if(candidate.processed>best.processed) {best=candidate;frozen.aiResults={...frozen.aiResults,[branchId]:entry};frozen.aiDrafts={};}
    }
    const sameExecution=t=>t.key===record.key&&t.branchId===branchId&&t.fingerprint===prepared.fingerprint&&t.record?.source?.filterVersion===record.source?.filterVersion&&executionSignature(t)===executionSignature(spec);
    const duplicate=list.find(t=>sameExecution(t)&&['queued','running'].includes(t.state));
    if(duplicate) return duplicate;
    // Automation never requeues this failed/interrupted request. A user start
    // creates a new task with the current settings, leaving the old audit intact.
    if(!manual){
      const stopped=list.find(t=>sameExecution(t)&&['error','interrupted'].includes(t.state));
      if(stopped)return stopped;
    }
    if(!manual&&best.processed===prepared.input.rounds.length){
      const done=list.find(t=>sameExecution(t)&&t.state==='done');
      if(done&&!AtlasBatch.briefs.missing(best.result).length)return done;
    }
    const task={id:crypto.randomUUID(),key:record.key,title:record.title,branchId,manual,rebuild:!spec.profile.reuseResults,state:'queued',createdAt:new Date().toISOString(),fingerprint:prepared.fingerprint,
      settingsSignature:sig,record:frozen,...spec,processed:best.processed,total:prepared.input.rounds.length,requests:0,error:null};
    list.push(task);return task;
  }
  async function start(key,branchId='current') {
    await init();
    const result=await lock(async()=>{
      const record=await get('conversation:'+key);if(!record)throw new Error('对话记录不存在。');
      await enqueue(async()=>{const latest=await get('conversation:'+key);if(!latest)throw new Error('对话记录不存在。');latest.organizeEnabled=true;await chrome.storage.local.set({['conversation:'+key]:latest});});
      record.organizeEnabled=true;
      const list=await tasks(), task=await create(record,branchId,true,list);
      await store(list); await archive(record,list,'加入整理队列');
      await chrome.storage.local.set({'atlas:queue-error':null});
      return {ok:true,id:task.id,reused:task.processed,total:task.total};
    });
    await wake(); return result;
  }
  async function observe(record) {
    await init();
    return lock(async()=>{
      record=await get('conversation:'+record.key)||record;
      const list=await tasks(), config=await settings(), sig=fingerprint(record);
      const cache=await get('atlas:observed')||{}, previous=cache[record.key];
      // Capture polling that only changes timestamps must not postpone the idle timer.
      const changed=!previous||previous.fingerprint!==sig;
      const justFinished=completed(record)&&!previous?.finished;
      cache[record.key]={fingerprint:sig,finished:completed(record)};
      await chrome.storage.local.set({'atlas:observed':cache});
      const intents=await get('atlas:intents')||{};
      if(config.mode==='off'||!record.organizeEnabled||!completed(record)) delete intents[record.key];
      else if(changed||justFinished) intents[record.key]={key:record.key,fingerprint:sig,due:Date.now()+(config.mode==='immediate'?0:config.delay*1000)};
      await chrome.storage.local.set({'atlas:intents':intents});
      await archive(record,list,'对话自动保存');
      if(/^(文件夹保存失败|等待文件夹授权)/.test(String(await get('atlas:queue-error')||'')))await chrome.storage.local.set({'atlas:queue-error':null});
      const due=Object.values(intents).map(i=>i.due); if(due.length) await wake(Math.min(...due));
    });
  }
  async function checkpoint(id,entry,complete) {
    return lock(async()=>{
      const list=await tasks(), t=list.find(t=>t.id===id);
      if(!t||t.state==='cancelled')throw new Error('任务已取消。');
      t.processed=entry.roundSignatures.length;
      if(entry.history)t.historyReview=structuredClone(entry.history);
      if(entry.directory)t.directoryReview=structuredClone(entry.directory);
      t.record.aiDrafts={...t.record.aiDrafts,[t.branchId]:entry};
      if(complete){t.record.aiResults={...t.record.aiResults,[t.branchId]:entry};delete t.record.aiDrafts[t.branchId];}
      await enqueue(async()=>{
      const latest=await get('conversation:'+t.key); if(!latest)throw new Error('对话缓存已删除；任务停止。');
      latest.aiHistory=[...(latest.aiHistory||[]).filter(h=>!(h.branchId===t.branchId&&h.entry.fingerprint===entry.fingerprint)),{branchId:t.branchId,entry,complete:!!complete}];
      if(fingerprint(latest,t.branchId)===t.fingerprint){
        if(complete){latest.aiResults={...latest.aiResults,[t.branchId]:entry};if(latest.aiDrafts)delete latest.aiDrafts[t.branchId];}
        else latest.aiDrafts={...latest.aiDrafts,[t.branchId]:entry};
      }
      await store(list);await chrome.storage.local.set({['conversation:'+t.key]:latest});
      // Tasks contain their immutable source snapshot, so old path results stay recoverable.
      await archive(latest,list,complete?'关系图完成':'整理分段检查点');
      });
    });
  }
  async function pump() {
    if(pumping)return; pumping=true;
    try {
      await init();
      const task=await lock(async()=>{
        const list=await tasks(), intents=await get('atlas:intents')||{}, config=await settings();
        for(const [key,intent]of Object.entries(intents))if(intent.due<=Date.now()){
          const record=await get('conversation:'+key);
          if(config.mode!=='off'&&record?.organizeEnabled&&completed(record)&&fingerprint(record)===intent.fingerprint){
            // create() suppresses only an identical failed execution, not new
            // snapshots or explicit user tasks for the same conversation.
            try{await create(record,'current',false,list);await chrome.storage.local.set({'atlas:queue-error':null});}catch(e){await chrome.storage.local.set({'atlas:queue-error':e.message});}
          }
          delete intents[key];
        }
        await chrome.storage.local.set({'atlas:intents':intents});
        const next=list.find(t=>t.state==='queued');
        if(next){
          // Earlier queued snapshots may have finished since this snapshot was created.
          // Rebase only analysis seeds, never its immutable source messages or annotations.
          if(!next.rebuild){
            const latest=await get('conversation:'+next.key), input=AtlasAI.prepare(next.record,next.branchId).input;
            let best=AtlasBatch.resume(next.record,next.branchId,input,next.settingsSignature,true);
            for(const h of latest?.aiHistory||[]){
              const entry=retarget(h.entry,next.branchId), candidate=AtlasBatch.resume({...next.record,aiResults:{[next.branchId]:entry},aiDrafts:{}},next.branchId,input,next.settingsSignature,true);
              if(candidate.processed>best.processed){best=candidate;next.record.aiResults={...next.record.aiResults,[next.branchId]:entry};next.record.aiDrafts={};next.processed=best.processed;}
            }
          }
          next.state='running';next.startedAt=new Date().toISOString();
        }
        await store(list);return next?structuredClone(next):null;
      });
      if(!task)return;
      try {
        const library=await AtlasLibrary.state();
        if(library.connected&&(!library.granted||library.error))throw AtlasAI.problem('资料库检查','LIBRARY_UNAVAILABLE','资料库无法正常保存，请先在资料库设置中重新授权并同步，再续做。',{nextStep:'在资料库设置检查授权和同步状态；当前状态不足以确定是授权还是写盘问题，先恢复保存能力。'});
        const result=await AtlasAPI.extract({key:task.key,branchId:task.branchId},fn=>fn(),{record:task.record,profile:task.profile,prompt:task.prompt,checkpoint:(entry,done)=>checkpoint(task.id,entry,done)});
        await lock(async()=>{const list=await tasks(),t=list.find(t=>t.id===task.id);if(t&&t.state!=='cancelled'){t.state=result.partial?'queued':'done';t.requests+=result.requests+(result.historyRequests||0)+(result.briefRequests||0);t.finishedAt=result.partial?null:new Date().toISOString();}await store(list);const r=await get('conversation:'+task.key);if(r)await archive(r,list,'队列进度保存');});
      } catch(e) {
        const reported=AtlasAI.describeError(e,'后台任务');
        await lock(async()=>{const list=await tasks(),t=list.find(t=>t.id===task.id);if(t&&t.state!=='cancelled'){t.state='error';t.error=reported.message;t.errorDiagnostics=structuredClone(reported.diagnostics);}await store(list);});
      }
    } finally {
      pumping=false;
      const list=await tasks(), intents=Object.values(await get('atlas:intents')||{});
      if(list.some(t=>t.state==='queued'))await wake();else if(intents.length)await wake(Math.min(...intents.map(i=>i.due)));
    }
  }
  async function act(id,action) {
    await init();
    const result=await lock(async()=>{
      const list=await tasks(),t=list.find(t=>t.id===id);if(!t)throw new Error('任务不存在。');
      if(action==='cancel'){t.state='cancelled';AtlasAPI.cancel(t.key,t.branchId);}
      else if(['error','interrupted','cancelled'].includes(t.state)){
        if(!await get('conversation:'+t.key))throw new Error('对话记录已删除，请先从资料库恢复。');
        t.state='queued';t.error=null;t.errorDiagnostics=null;
      }
      await store(list);return {ok:true};
    });await wake();return result;
  }
  async function remove(key) {
    await init();return lock(async()=>{
      const list=await tasks();for(const t of list)if(t.key===key&&t.state!=='done'){t.state='cancelled';AtlasAPI.cancel(t.key,t.branchId);}
      const intents=await get('atlas:intents')||{};delete intents[key];
      await store(list);await chrome.storage.local.set({'atlas:intents':intents});
    });
  }
  async function list() {
    await init();const all=await tasks();
    return {tasks:all.slice().reverse().map(({record,profile,prompt,...safe})=>safe),settings:await settings(),library:await AtlasLibrary.state(),notice:await get('atlas:queue-error')};
  }
  async function configure(message) {
    const mode=['off','idle','immediate'].includes(message.mode)?message.mode:'idle', delay=Number(message.delay);
    if(!Number.isInteger(delay)||delay<5||delay>3600)throw new Error('等待时间应为 5 至 3600 秒。');
    await chrome.storage.local.set({[settingsKey]:{mode,delay},'atlas:intents':{}});
    // Apply the new timing to opted-in conversations, including an existing idle response.
    const all=await chrome.storage.local.get(null);
    await chrome.storage.local.set({'atlas:observed':{}});
    for(const[k,r]of Object.entries(all))if(k.startsWith('conversation:')&&r.organizeEnabled)await observe(r);
    return {ok:true};
  }
  async function receive(m,sender) {
    if(!AtlasTrust.isUI(sender))throw new Error('此操作仅允许从扩展界面执行。');
    if(m.type==='queue-start')return start(m.key,m.branchId||'current');
    if(m.type==='queue-list')return list();
    if(m.type==='queue-action')return act(m.id,m.action);
    if(m.type==='queue-settings')return configure(m);
    if(m.type==='library-state')return AtlasLibrary.state();
    if(m.type==='library-connect'||m.type==='library-reconnect') {
      const result=m.type==='library-reconnect'?await AtlasLibrary.reconnect():await AtlasLibrary.connect(m.migrate,m.pathLabel);
      if(/^(文件夹保存失败|等待文件夹授权)/.test(String(await get('atlas:queue-error')||'')))await chrome.storage.local.set({'atlas:queue-error':null});
      return result;
    }
    if(m.type==='library-versions')return {versions:await AtlasLibrary.versions(m.key)};
    if(m.type==='library-restore'){
      const active=(await tasks()).some(t=>t.key===m.key&&['queued','running'].includes(t.state));
      if(active)throw new Error('请先取消这条对话的排队和运行任务，再恢复版本。');
      const intents=await get('atlas:intents')||{};delete intents[m.key];await chrome.storage.local.set({'atlas:intents':intents});
      return AtlasLibrary.restore(m.key,m.id);
    }
    throw new Error('未知资料库请求。');
  }
  chrome.alarms?.onAlarm.addListener(a=>{if(a.name==='atlas-queue')pump().catch(console.error);});
  chrome.runtime.onStartup?.addListener(()=>init().then(()=>wake()));
  return {receive,observe,pump,init,remove};
})();
