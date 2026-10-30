/* Derived, rebuildable UI index. Canonical sources and library backups stay intact. */
(() => {
  'use strict';
  const A=typeof Atlas!=='undefined'?Atlas:require('./core.js');
  const AI=typeof AtlasAI!=='undefined'?AtlasAI:require('./ai.js');
  const blockSize=16384;
  async function digest(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function indexed(){
    let pending;
    async function db(){
      if(!pending)pending=new Promise((resolve,reject)=>{const r=indexedDB.open('topic-atlas-views',1);r.onupgradeneeded=()=>{r.result.createObjectStore('data');};r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>{d.close();pending=null;};resolve(d);};r.onerror=()=>{pending=null;reject(r.error);};});
      return pending;
    }
    return {
      async get(key){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('data','readonly'),r=tx.objectStore('data').get(key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});},
      async commit(puts,deletes=[]){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('data','readwrite'),s=tx.objectStore('data');for(const key of deletes)s.delete(key);for(const [key,value]of puts)s.put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
    };
  }
  function create(adapter,storage,notify=async()=>{}){
    let serial=Promise.resolve(),migrating,currentView=null;
    const lock=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p;};
    const getSource=async key=>(await storage.get('conversation:'+key))['conversation:'+key];
    function bodyKeys(view){return (view?.allMessages||[]).flatMap(m=>Array.from({length:Math.ceil(m.textLength/blockSize)},(_,i)=>m.bodyRef+':'+i));}
    async function publishInside(record){
      const key=record.key,old=await adapter.get('view:'+key),oldBodies=new Set(bodyKeys(old)),puts=[],metadata=[],byId=new Map(),groups=new Map();
      const raw=record.allMessages||record.messages||[];
      for(const group of raw){
        const ids=[];
        for(const m of A.answerMessages(group.segments||[group])){
          if(!byId.has(m.id)){
            const text=String(m.text||''),hash=await digest(JSON.stringify(text)),ref='body:'+key+':'+m.id+':'+hash;
            const meta={id:m.id,nativeId:m.nativeId||null,nodeId:m.nodeId||null,role:m.role,channel:m.channel||null,status:m.status||null,createdAt:m.createdAt||null,nonText:!!m.nonText,recipient:m.recipient||null,contentType:m.contentType||null,
              text:A.excerpt(text,120),textLength:text.length,bodyHash:hash,bodyRef:ref};
            byId.set(m.id,meta);metadata.push(meta);
            for(let i=0;i<text.length;i+=blockSize){const block=ref+':'+Math.floor(i/blockSize);if(!oldBodies.has(block))puts.push([block,text.slice(i,i+blockSize)]);}
          }
          ids.push(m.id);
        }
        groups.set(group.id,ids);
      }
      const path=ids=>ids.flatMap(id=>groups.get(id)||(byId.has(id)?[id]:[]));
      const branches=(record.branches||[{id:'current',label:'网页当前路径',messageIds:(record.messages||[]).map(m=>m.id)}]).map(b=>({...b,messageIds:path(b.messageIds)}));
      const messages=path((record.messages||[]).map(m=>m.id)).map(id=>byId.get(id));
      const analysisByBranch={};
      const hasPublication=Object.keys(record.aiResults||{}).length||(record.aiHistory||[]).some(h=>h.complete);
      for(const branch of new Set(['current',...Object.keys(record.aiResults||{}),...(record.aiHistory||[]).filter(h=>h.complete).map(h=>h.branchId)])){
        if(!hasPublication)continue;
        if(!branches.some(b=>b.id===branch))continue;
        const entry=AI.displayAnalysis(record,branch);
        if(entry)analysisByBranch[branch]={result:entry.result,generatedAt:entry.generatedAt,model:entry.model,provider:entry.provider,stale:entry.stale};
      }
      const source=record.source?{type:record.source.type,completeness:record.source.completeness,note:record.source.note,omittedNonText:record.source.omittedNonText,unreadableContent:record.source.unreadableContent}:null;
      const view={viewOnly:true,key,url:record.url,title:record.title,platform:record.platform,createdAt:record.createdAt,annotations:record.annotations||{},directionTasks:record.directionTasks||{},source,allMessages:metadata,messages,branches,analysisByBranch};
      view.renderRevision=await digest(JSON.stringify({metadata,messages,branches,annotations:view.annotations,directionTasks:view.directionTasks,analysisByBranch}));
      const revision=await digest(JSON.stringify(view));
      if(old?.revision===revision)return {changed:false,revision};
      view.revision=revision;view.updatedAt=record.updatedAt;
      const catalog=await adapter.get('catalog')||{};
      catalog[key]={key,url:record.url,title:record.title,platform:record.platform,updatedAt:record.updatedAt,revision,renderRevision:view.renderRevision,messageCount:messages.length,branchCount:branches.length};
      const nextBodies=new Set(bodyKeys(view));
      await adapter.commit([...puts,['view:'+key,view],['catalog',catalog]],[...oldBodies].filter(k=>!nextBodies.has(k)));
      if(currentView?.key===key)currentView=null;
      await notify(catalog);return {changed:true,revision};
    }
    async function ensure(){
      if(!migrating)migrating=lock(async()=>{
        if(await adapter.get('migrated-v1'))return;
        // Modern Edge enumerates keys without allocating every stored value.
        const names=typeof storage.getKeys==='function'?await storage.getKeys():Object.keys(await storage.get(null));
        for(const name of names.filter(k=>k.startsWith('conversation:'))){const record=(await storage.get(name))[name];if(record)await publishInside(record);}
        await adapter.commit([['migrated-v1',true]]);
      }).catch(e=>{migrating=null;throw e;});
      await migrating;
    }
    async function get(key,branch='current'){
      await ensure();await serial;
      let view=currentView?.key===key?currentView:await adapter.get('view:'+key);
      if(!view){const record=await getSource(key);if(!record)throw new Error('本地对话不存在。');await lock(()=>publishInside(record));view=await adapter.get('view:'+key);}
      currentView=view;
      if(!view.branches.some(b=>b.id===branch))throw new Error('所选分支不存在，请重新选择。');
      const {analysisByBranch,...light}=view;
      return {...light,viewBranch:branch,viewAnalysis:analysisByBranch[branch]||null};
    }
    async function body(m,aligned=false){
      const view=await get(m.key,m.branchId||'current');
      const branch=view.branches.find(b=>b.id===(m.branchId||'current')),allowed=new Set(branch.messageIds),ids=m.ids;
      if(!Array.isArray(ids)||!ids.length||ids.length>30000||ids.some(id=>!allowed.has(id))||new Set(ids).size!==ids.length)throw new Error('正文引用不属于当前对话分支。');
      const positions=ids.map(id=>branch.messageIds.indexOf(id));
      if(positions.some((p,i)=>i&&p!==positions[i-1]+1))throw new Error('正文片段顺序不连续，未拼接其他轮次。');
      const parts=ids.map(id=>view.allMessages.find(p=>p.id===id)),total=parts.reduce((n,p)=>n+p.textLength,0)+2*(parts.length-1);
      if(parts.some(p=>p.role!==parts[0].role))throw new Error('不能把不同角色的消息拼成同一条正文。');
      const refsMatch=Array.isArray(m.bodyRefs)&&m.bodyRefs.length===parts.length&&parts.every((p,i)=>p.bodyRef===m.bodyRefs[i]);
      if((m.bodyRefs&&!refsMatch)||(m.revision!==view.revision&&!refsMatch))throw new Error('本地记录已更新，请重新展开正文。');
      const offset=m.full?0:Number(m.offset||0),length=m.full?total:Math.min(blockSize,Number(m.length||blockSize));
      if(!Number.isInteger(offset)||offset<0||offset>total||!Number.isInteger(length)||length<0)throw new Error('正文读取范围无效。');
      let end=Math.min(total,offset+length),cursor=0,text='',segments=[];
      for(const p of parts){
        const start=Math.max(0,offset-cursor),stop=Math.min(p.textLength,end-cursor);let value='';
        if(stop>start){for(let i=Math.floor(start/blockSize);i<=Math.floor((stop-1)/blockSize);i++){const block=await adapter.get(p.bodyRef+':'+i);if(typeof block!=='string')throw new Error('正文显示索引缺失，请刷新原对话重新建立；完整源记录仍保留。');value+=block.slice(Math.max(0,start-i*blockSize),Math.min(block.length,stop-i*blockSize));}text+=value;}
        if(m.full)segments.push({...p,text:value});
        cursor+=p.textLength;
        if(p!==parts.at(-1)){const a=Math.max(offset,cursor),b=Math.min(end,cursor+2);if(b>a)text+='\n\n'.slice(a-cursor,b-cursor);cursor+=2;}
      }
      if(!m.full&&!aligned&&offset>0&&/[\uDC00-\uDFFF]/.test(text[0]))return body({...m,offset:offset-1},true);
      if(!m.full&&end<total&&/[\uD800-\uDBFF]/.test(text.at(-1))){text=text.slice(0,-1);end--;}
      return {text,offset,end,total,...(m.full?{segments}:{})};
    }
    async function remove(key){return lock(async()=>{const view=await adapter.get('view:'+key),catalog=await adapter.get('catalog')||{};delete catalog[key];await adapter.commit([['catalog',catalog]],['view:'+key,...bodyKeys(view)]);if(currentView?.key===key)currentView=null;await notify(catalog);});}
    return {publish:r=>lock(()=>publishInside(r)),remove,get,body,
      async list(){await ensure();await serial;return {conversations:Object.values(await adapter.get('catalog')||{}).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))};},
      async receive(m,sender){
        if(!AtlasTrust.isUI(sender))throw new Error('本地显示索引仅允许扩展界面读取。');
        if(m.type==='view-list')return this.list();
        if(m.type==='view-get')return {record:await get(m.key,m.branchId||'current')};
        if(m.type==='view-body')return body(m);
        if(m.type==='view-export'){const record=await getSource(m.key);if(!record)throw new Error('本地对话不存在。');return {record};}
        throw new Error('未知显示索引操作。');
      }
    };
  }
  const enabled=typeof indexedDB!=='undefined';
  const live=enabled?create(indexed(),chrome.storage.local,catalog=>chrome.storage.local.set({'atlas:view-catalog':catalog,'atlas:view-error':null})):null;
  globalThis.AtlasViews={enabled,create,digest,blockSize,
    publish:r=>live?live.publish(r):Promise.resolve(),remove:key=>live?live.remove(key):Promise.resolve(),
    receive:(m,s)=>live?live.receive(m,s):Promise.reject(new Error('本地显示索引不可用，请检查浏览器 IndexedDB 权限。'))};
  if(typeof module!=='undefined')module.exports=globalThis.AtlasViews;
})();
