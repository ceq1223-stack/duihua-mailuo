/* Trusted extension contexts only. Handles, never paths, grant filesystem access. */
const AtlasLibrary = (() => {
  const DB = 'topic-atlas-library', STORE = 'handles';
  const suggestedPath = 'C:\\Users\\chen\\Documents\\Topic Atlas';
  let serial = Promise.resolve();
  function lock(fn) { const p = serial.then(fn); serial = p.catch(() => {}); return p; }
  function database() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async function handle(key = 'active', value) {
    const db = await database();
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, value === undefined ? 'readonly' : 'readwrite');
      const r = value === undefined ? tx.objectStore(STORE).get(key) : tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(r.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  }
  async function digest(text) {
    const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, '0')).join('');
  }
  async function read(dir, name, fallback) {
    try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); }
    catch (e) { if (e.name === 'NotFoundError' && fallback !== undefined) return fallback; throw e; }
  }
  async function write(dir, name, data) {
    const text = JSON.stringify(data, null, 2), f = await dir.getFileHandle(name, { create: true });
    const stream = await f.createWritable();
    try { await stream.write(text); await stream.close(); } catch (e) { await stream.abort().catch(() => {}); throw e; }
    if (await (await f.getFile()).text() !== text) throw new Error('文件写入校验失败：' + name);
    return digest(text);
  }
  async function root() {
    const h = await handle();
    if (!h) return null;
    const permission = await h.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw Object.assign(new Error(permission === 'denied' ? '资料库访问被拒绝，请点击侧栏“恢复文件夹访问”重新授权。' : '本次文件夹授权已结束，请点击侧栏“恢复文件夹访问”；若浏览器提供“每次访问都允许”，请选择该项。'), {code:'LIBRARY_PERMISSION_REQUIRED', permission});
    return h;
  }
  async function state() {
    const s = (await chrome.storage.local.get('atlas:library'))['atlas:library'] || {};
    try { const h = await handle(), permission = h ? await h.queryPermission({mode:'readwrite'}) : 'unconnected'; return { ...s, name: h?.name || '', connected: !!h, granted: permission === 'granted', permission, suggestedPath }; }
    catch { return { ...s, connected:false, granted:false, suggestedPath, error:'无法打开文件夹授权记录。' }; }
  }
  async function status(patch) {
    const s = (await chrome.storage.local.get('atlas:library'))['atlas:library'] || {};
    await chrome.storage.local.set({ 'atlas:library': { ...s, ...patch } });
  }
  function split(record, tasks = []) {
    const { aiResults = {}, aiDrafts = {}, ...source } = record;
    return { source, analysis: { aiResults, aiDrafts }, progress: { tasks } };
  }
  async function commit(h, bundle, reason = '自动保存') {
    const key = bundle.source.key, folder = await digest(key), base = await h.getDirectoryHandle('conversations', {create:true});
    const catalog = await read(h, 'topic-atlas.json', { format:'topic-atlas-library', version:1, conversations:{} });
    if (catalog.format !== 'topic-atlas-library' || catalog.version !== 1 || !catalog.conversations || typeof catalog.conversations !== 'object') throw new Error('所选目录已有不兼容的资料库。');
    const dir = await base.getDirectoryHandle(folder, {create:true});
    const index = await read(dir, 'index.json', { format:'topic-atlas-versions', key, versions:[] });
    if (index.key !== key || !Array.isArray(index.versions)) throw new Error('资料库索引格式异常，未覆盖。');
    const stable = structuredClone(bundle); delete stable.source.updatedAt;
    const signature = await digest(JSON.stringify(stable));
    if (index.versions[0]?.signature === signature) {
      // Repair a catalog pointer if the previous worker stopped after writing index.json.
      catalog.conversations[key]={folder,title:bundle.source.title,latest:index.versions[0].id};
      await write(h,'topic-atlas.json',catalog);return index.versions[0];
    }
    const id = Date.now().toString(36) + '-' + crypto.randomUUID();
    const revision = await dir.getDirectoryHandle(id, {create:true}), hashes = {};
    for (const [name, data] of Object.entries(bundle)) hashes[name + '.json'] = await write(revision, name + '.json', data);
    const entry = { id, signature, createdAt:new Date().toISOString(), reason, hashes };
    await write(revision, 'commit.json', entry);
    // A version becomes visible only after all files have closed and passed verification.
    index.versions.unshift(entry); await write(dir, 'index.json', index);
    catalog.conversations[key] = { folder, title:bundle.source.title, latest:id };
    await write(h, 'topic-atlas.json', catalog);
    return entry;
  }
  async function bundleAt(h, key, id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('版本标识无效。');
    const dir = await (await h.getDirectoryHandle('conversations')).getDirectoryHandle(await digest(key));
    const index = await read(dir, 'index.json');
    const item = index.versions.find(v => v.id === id); if (!item) throw new Error('备份版本不存在。');
    const rev = await dir.getDirectoryHandle(id), bundle = {};
    for (const name of ['source','analysis','progress']) {
      const text = await (await (await rev.getFileHandle(name + '.json')).getFile()).text();
      if (await digest(text) !== item.hashes[name + '.json']) throw new Error('备份完整性校验失败，未恢复。');
      bundle[name] = JSON.parse(text);
    }
    if (bundle.source.key !== key) throw new Error('备份归属不符。');
    return bundle;
  }
  async function persist(record, tasks = [], reason) {
    return lock(async () => {
      try {
        const h = await root(); if (!h) return { cached:true };
        const version = await commit(h, split(record,tasks), reason);
        await status({ error:null, errorCode:null, lastSavedAt:new Date().toISOString() }); return version;
      } catch (e) {
        const permission = e.code === 'LIBRARY_PERMISSION_REQUIRED' || e.name === 'NotAllowedError';
        const message = permission ? '等待文件夹授权；新内容暂存浏览器。' + e.message : '文件夹保存失败；浏览器缓存仍保留。' + e.message;
        await status({error:message,errorCode:permission?'LIBRARY_PERMISSION_REQUIRED':'LIBRARY_WRITE_FAILED'});
        throw Object.assign(new Error(message),{code:permission?'LIBRARY_PERMISSION_REQUIRED':'LIBRARY_WRITE_FAILED'});
      }
    });
  }
  async function connect(migrate = true, pathLabel = '') {
    return lock(async () => {
      const target = await handle('pending');
      if (!target || await target.queryPermission({mode:'readwrite'}) !== 'granted') throw new Error('请先选择并授权文件夹。');
      // Reject unrelated or incompatible manifests before writing any managed files.
      const existing = await read(target, 'topic-atlas.json', null);
      if (existing && (existing.format !== 'topic-atlas-library' || existing.version !== 1 || !existing.conversations || typeof existing.conversations !== 'object')) throw new Error('所选文件夹中的资料库格式不兼容。');
      let count = 0;
      const old = await handle();
      if (migrate && old && !await old.isSameEntry(target)) {
        if (await old.queryPermission({mode:'readwrite'}) !== 'granted') throw new Error('迁移前请先重新授权旧资料库。');
        const catalog = await read(old,'topic-atlas.json',{conversations:{}});
        for (const key of Object.keys(catalog.conversations)) {
          const dir = await (await old.getDirectoryHandle('conversations')).getDirectoryHandle(await digest(key));
          const index = await read(dir,'index.json');
          for (const v of [...index.versions].reverse()) { await commit(target,await bundleAt(old,key,v.id),'迁移：' + v.reason); count++; }
        }
      }
      // Preserve browser originals. Their latest content is copied and verified, never deleted here.
      const all = await chrome.storage.local.get(null), queue = all['atlas:queue'] || [];
      for (const [key,record] of Object.entries(all)) if (key.startsWith('conversation:')) {
        await commit(target, split(record,queue.filter(t=>t.key===record.key)), '浏览器记录迁移'); count++;
      }
      // Existing folder records also become available on a new extension installation.
      const catalog = await read(target,'topic-atlas.json',{conversations:{}});
      for (const [key,item] of Object.entries(catalog.conversations)) if (!all['conversation:'+key]) {
        const b = await bundleAt(target,key,item.latest);
        await chrome.storage.local.set({['conversation:'+key]:{...b.source,...b.analysis}});
      }
      await handle('active',target);
      await status({name:target.name,pathLabel:String(pathLabel).slice(0,1000),error:null,errorCode:null,lastSavedAt:new Date().toISOString(),migrated:count});
      return {ok:true,count};
    });
  }
  async function reconnect() {
    // The user grants access in a visible extension page. A worker never prompts.
    // Reconnect only the active library: do not use the shared pending picker handle.
    return lock(async () => {
      const target = await root(); if (!target) throw new Error('尚未选择文件夹，请先打开资料库设置。');
      const existing = await read(target,'topic-atlas.json',null);
      if (existing && (existing.format !== 'topic-atlas-library' || existing.version !== 1 || !existing.conversations || typeof existing.conversations !== 'object')) throw new Error('资料库格式不兼容，未同步。');
      const all = await chrome.storage.local.get(null), queue = all['atlas:queue'] || [];
      let count = 0;
      for (const [key,record] of Object.entries(all)) if (key.startsWith('conversation:')) {
        await commit(target,split(record,queue.filter(t=>t.key===record.key)),'恢复授权后同步'); count++;
      }
      await status({error:null,errorCode:null,lastSavedAt:new Date().toISOString()});
      return {ok:true,count};
    });
  }
  async function versions(key) {
    const h = await root(); if (!h) return [];
    try { const dir = await (await h.getDirectoryHandle('conversations')).getDirectoryHandle(await digest(key)); return (await read(dir,'index.json')).versions; }
    catch(e) { if (e.name === 'NotFoundError') return []; throw e; }
  }
  async function restore(key,id) {
    const h = await root(); if (!h) throw new Error('尚未连接资料库。');
    const b = await bundleAt(h,key,id), record = {...b.source,...b.analysis,organizeEnabled:false,updatedAt:new Date().toISOString()};
    const old = (await chrome.storage.local.get('conversation:'+key))['conversation:'+key];
    if (old) await persist(old,[],'恢复前备份');
    await persist(record,[],'恢复历史版本');
    await chrome.storage.local.set({['conversation:'+key]:record});
    return {ok:true};
  }
  return { handle,state,persist,connect,reconnect,versions,restore,root };
})();
