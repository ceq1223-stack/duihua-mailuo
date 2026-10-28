importScripts('core.js', 'reader.js', 'prompt.js', 'ai.js', 'batch.js','fragments.js', 'trust.js','ui-events.js','views.js', 'api-worker.js', 'library.js', 'queue.js');
// Deny content scripts access to stored API credentials and private archives.
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
]);
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
let writes = Promise.resolve();
function enqueue(operation) {
  const task = writes.then(operation); writes = task.catch(() => {}); return task;
}
function keyFor(key) { return 'conversation:' + key; }
function sameCapture(old,next){
  if(!old||old.title!==next.title||old.platform!==next.platform||old.url!==next.url)return false;
  const a=old.allMessages||old.messages||[],b=next.allMessages||next.messages||[];
  if(a.length!==b.length)return false;
  const fields=['id','nativeId','role','text','channel','status','createdAt','nonText','recipient','contentType','endTurn','toolCall'];
  for(let i=0;i<a.length;i++)for(const field of fields)if(a[i][field]!==b[i][field])return false;
  return JSON.stringify([old.source,old.branches,old.activeNode,(old.messages||[]).map(m=>m.id)])===JSON.stringify([next.source,next.branches,next.activeNode,(next.messages||[]).map(m=>m.id)]);
}
function sameView(before,after){
  if(!sameCapture(before,after)||JSON.stringify(before?.annotations)!==JSON.stringify(after.annotations))return false;
  const entries=r=>[Object.entries(r.aiResults||{}).map(([branch,e])=>[branch,e.result,e.generatedAt,e.model,e.provider]),(r.aiHistory||[]).filter(h=>h.complete).map(h=>[h.branchId,h.entry?.result,h.entry?.generatedAt,h.entry?.model,h.entry?.provider])];
  return JSON.stringify(entries(before))===JSON.stringify(entries(after));
}
async function receive(message, sender) {
  await storageReady;
  if (message.type === 'get-auto-settings') return { enabled: (await chrome.storage.local.get('atlas:settings'))['atlas:settings']?.autoCapture !== false };
  if (['read-structured', 'capture'].includes(message.type)) {
    const settings = (await chrome.storage.local.get('atlas:settings'))['atlas:settings'];
    if (settings?.autoCapture === false) throw new Error('自动读取已暂停。');
  }
  if (['read-structured','diagnose-message-markers'].includes(message.type)) {
    const diagnostic=message.type==='diagnose-message-markers';
    if(diagnostic&&!AtlasTrust.isUI(sender))throw new Error('消息标记诊断仅允许从扩展界面执行。');
    const tabId = diagnostic?message.tabId:sender.tab?.id || message.tabId;
    if (!Number.isInteger(tabId)) throw new Error('网页连接缺少标签页信息。');
    const tab = await chrome.tabs.get(tabId), actual = Atlas.conversation(tab.url || '');
    const id = actual?.url?.match(/\/c\/([^/]+)/)?.[1];
    if (actual?.platform !== 'ChatGPT' || !id) throw new Error('请先打开一条已保存的 ChatGPT 对话。');
    const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: readChatGPTPage, args: diagnostic?[id,true]:[id] });
    const result = results[0]?.result;
    if (!result || result.error) {
      const code = result?.error || 'NO_RESULT';
      const messages = { HTTP_401: '登录状态不可用，请刷新 ChatGPT 并确认已登录。', HTTP_403: 'ChatGPT 拒绝了读取请求；请在网页确认访问验证后重试。', HTTP_404: '当前会话接口未找到，可能已删除、无权访问或接口路径已变化。', HTTP_429: '读取过于频繁，请稍后重试。', TIMEOUT: '读取超时，请检查网络后重试。', PAGE_CHANGED: '读取期间切换了对话，请重新采集。', SCHEMA_CHANGED: 'ChatGPT 返回的数据结构已变化，需要更新适配。' };
      throw new Error('结构化读取失败 [' + code + ']：' + (messages[code] || '未获得可用的 JSON 对话数据。请复制诊断信息。'));
    }
    if(diagnostic){
      const after=await chrome.tabs.get(tabId);
      if(Atlas.conversation(after.url||'')?.key!==actual.key)throw new Error('诊断期间切换了对话，结果已丢弃，请在目标对话重试。');
      if(!result.diagnostics||result.diagnostics.schemaVersion!=='message-markers-1')throw new Error('未获得消息标记诊断，请重新加载扩展后重试。');
      return {messageMarkers:result.diagnostics};
    }
    const normalized = Atlas.normalizeChatGPT(result.data);
    const after = await chrome.tabs.get(tabId);
    if (Atlas.conversation(after.url || '')?.key !== actual.key) throw new Error('读取期间切换了对话，未保存到其他会话。');
    const key = keyFor(actual.key), stored = (await chrome.storage.local.get(key))[key], now = new Date().toISOString();
    const annotations = { ...stored?.annotations };
    // Migrate old DOM annotations only when there is exactly one matching message.
    for (const old of stored?.messages || []) {
      if (!annotations[old.id]) continue;
      const matches = normalized.allMessages.filter(m => m.nativeId === old.nativeId || (m.text === old.text && (m.role === old.role || old.role === 'unknown')));
      if (matches.length === 1 && !annotations[matches[0].id]) annotations[matches[0].id] = annotations[old.id];
    }
    const record = { ...stored, key: actual.key, url: actual.url, platform: 'ChatGPT', title: result.data.title || tab.title || 'ChatGPT', createdAt: stored?.createdAt || now, updatedAt: now, annotations, aiResults: stored?.aiResults || {}, aiDrafts: stored?.aiDrafts || {}, ...normalized };
    if ((await chrome.storage.local.get('atlas:settings'))['atlas:settings']?.autoCapture === false) throw new Error('自动读取已暂停，未保存新的读取结果。');
    if(sameCapture(stored,record))return {unchanged:true,count:normalized.allMessages.length,activeCount:normalized.messages.length,branchCount:normalized.branches.length,source:normalized.source};
    await chrome.storage.local.set({ [key]: record });
    return { count: normalized.allMessages.length, activeCount: normalized.messages.length, branchCount: normalized.branches.length, source: normalized.source };
  }
  if (message.type === 'capture') {
    const actual = Atlas.conversation(sender.tab?.url || '');
    if (!actual?.key || actual.key !== message.conversation?.key) throw new Error('采集来源与当前网页不一致。');
    if (!Array.isArray(message.messages) || message.messages.length > 10000) throw new Error('消息格式或数量异常。');
    const incoming = message.messages.filter(m => ['user', 'assistant', 'unknown'].includes(m.role) && typeof m.id === 'string' && typeof m.text === 'string').map(m => ({ ...m, text: m.text.slice(0, 500000) }));
    const key = keyFor(actual.key), stored = (await chrome.storage.local.get(key))[key];
    const now = new Date().toISOString();
    const record = { ...stored, key: actual.key, url: actual.url, platform: actual.platform, title: String(message.title || actual.platform).slice(0, 300), updatedAt: now, createdAt: stored?.createdAt || now, annotations: stored?.annotations || {}, messages: Atlas.merge(stored, incoming, now) };
    if(sameCapture(stored,record))return {ok:true,unchanged:true};
    await chrome.storage.local.set({ [key]: record });
    return { ok: true };
  }
  if (message.type === 'annotate') {
    if (!AtlasTrust.isUI(sender)) throw new Error('只能从扩展界面修改主题。');
    const key = keyFor(message.key), record = (await chrome.storage.local.get(key))[key];
    if (!record || !(record.allMessages || record.messages).some(m => m.id === message.turnId)) throw new Error('记录不存在。');
    const relation = ['flow', 'branch', 'return'].includes(message.relation) ? message.relation : '';
    record.annotations[message.turnId] = { topic: String(message.topic || '').trim().slice(0, 80), summary: String(message.summary || '').slice(0, 1000), relation };
    await chrome.storage.local.set({ [key]: record });
    if(typeof AtlasViews!=='undefined')await AtlasViews.publish(record);
    return { ok: true };
  }
  if (message.type === 'delete') {
    if (!AtlasTrust.isUI(sender)) throw new Error('只能从扩展界面删除记录。');
    await chrome.storage.local.remove(keyFor(message.key));
    if(typeof AtlasViews!=='undefined')await AtlasViews.remove(message.key);
    await chrome.storage.local.set({ 'atlas:settings': { autoCapture: false } }); return { ok: true };
  }
  return { error: '未知请求。' };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(typeof message?.type==='string'&&message.type.startsWith('view-')){
    storageReady.then(()=>AtlasViews.receive(message,sender)).then(reply,error=>reply({error:error.message||'本地显示索引读取失败。'}));return true;
  }
  if (message?.type === 'delete' && AtlasTrust.isUI(sender)) {
    storageReady.then(() => AtlasQueue.remove(message.key)).then(() => enqueue(() => receive(message,sender))).then(reply,error=>reply({error:error.message}));
    return true;
  }
  if (typeof message?.type === 'string' && /^(queue|library)-/.test(message.type)) {
    storageReady.then(() => AtlasQueue.receive(message, sender)).then(reply, error => reply({error:error.message || '资料库操作失败。'}));
    return true;
  }
  if (typeof message?.type === 'string' && message.type.startsWith('ai-')) {
    storageReady.then(() => AtlasAPI.receive(message, sender, enqueue)).then(reply, error => reply({ error: error.message || 'API 操作失败。' }));
    return true;
  }
  if (!['read-structured', 'diagnose-message-markers', 'capture', 'annotate', 'delete', 'get-auto-settings'].includes(message?.type)) return;
  const task = enqueue(() => receive(message, sender));
  task.then(reply, error => reply({ error: error.message || '保存失败，可能已超出本机存储配额。请先导出备份。' }));
  return true;
});
chrome.storage.onChanged?.addListener((changes, area) => {
  if(area==='local'&&typeof AtlasUpdates!=='undefined'){
    const small={};for(const key of ['atlas:view-catalog','atlas:view-error','atlas:queue-summary','atlas:library','atlas:queue-error','atlas:settings'])if(changes[key])small[key]={newValue:changes[key].newValue};
    if(Object.keys(small).length)AtlasUpdates.notify({type:'view-notice',changes:small});
  }
  if (area === 'local') for (const [key,change] of Object.entries(changes)) {
    if(key.startsWith('conversation:')&&typeof AtlasViews!=='undefined'&&(!change.newValue||!sameView(change.oldValue,change.newValue))){
      const job=change.newValue?AtlasViews.publish(change.newValue):AtlasViews.remove(key.slice(13));
      job.catch(error=>chrome.storage.local.set({'atlas:view-error':error.message||'显示索引更新失败。'}));
    }
    if (key.startsWith('conversation:') && change.newValue) AtlasQueue.observe(change.newValue).catch(error => chrome.storage.local.set({'atlas:queue-error':error.message}));
  }
  if (area !== 'local' || !changes['atlas:settings']) return;
  const enabled = changes['atlas:settings'].newValue?.autoCapture !== false;
  chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://gemini.google.com/*'] }).then(tabs => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'auto-setting', enabled }).catch(() => {}));
  }).catch(() => {});
});
