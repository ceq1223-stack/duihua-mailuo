'use strict';
const $ = id => document.getElementById(id);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let records = [], selectedKey = '', view = 'timeline', editTurn = null, tabId = null, selectedBranch = 'current', followActive = true;
let aiConfig = null, extracting = null, topicSelection = null, directRequest = false;
let queueTasks = [];
let statusTimer;
const rawRecord = () => records.find(r => r.key === selectedKey);
const current = () => {
  const record = rawRecord();
  const branch = record?.branches?.find(b => b.id === selectedBranch);
  if (!record?.allMessages || !branch) return record;
  const byId = new Map(record.allMessages.map(m => [m.id, m]));
  return { ...record, messages: branch.messageIds.map(id => byId.get(id)).filter(Boolean) };
};
function status(text, error = false) { clearTimeout(statusTimer); $('status').hidden=!error; $('status').textContent=error?text:''; $('status').classList.toggle('error',error); if(error)statusTimer=setTimeout(()=>{$('status').hidden=true;},8000); }
function quietStatus(text) { $('settingsButton').title='设置 · '+text; }
async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
async function request(message) { const result = await chrome.runtime.sendMessage(message); if (result?.error) throw new Error(result.error); return result; }
async function toPage(message) {
  const tab = await activeTab();
  if (!tab?.id || !Atlas.conversation(tab.url || '')) throw new Error('请先切换到 ChatGPT 或 Gemini 对话网页。');
  try { return await chrome.tabs.sendMessage(tab.id, message); }
  catch {
    // Reconnect tabs which were already open when the extension was installed.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['core.js', 'locator.js', 'automatic.js'] });
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch { throw new Error('网页尚未连接或扩展缺少新增权限。请在扩展管理页重新加载并刷新 ChatGPT 网页。'); }
  }
}
async function load(followTab = false) {
  const all = await chrome.storage.local.get(null);
  $('automatic').checked = all['atlas:settings']?.autoCapture !== false;
  records = Object.entries(all).filter(([key]) => key.startsWith('conversation:')).map(([, record]) => record).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const tab = await activeTab(); tabId = tab?.id;
  const info = Atlas.conversation(tab?.url || '');
  if (followTab && records.some(r => r.key === info?.key)) { if (selectedKey !== info.key) selectedBranch = 'current'; selectedKey = info.key; }
  if (!records.some(r => r.key === selectedKey)) selectedKey = records[0]?.key || '';
  $('archive').innerHTML = records.length ? records.map(r => `<option value="${esc(r.key)}">${esc(r.platform)} · ${esc(r.title)}</option>`).join('') : '<option value="">选择本机对话记录</option>';
  $('archive').value = selectedKey;
  if (!rawRecord()?.branches?.some(b => b.id === selectedBranch)) selectedBranch = 'current';
  render();
}
function setView(next) {
  view = next; $('timeline').hidden = view !== 'timeline'; $('graph').hidden = view !== 'graph';
  $('timelineTab').setAttribute('aria-selected', view === 'timeline'); $('graphTab').setAttribute('aria-selected', view === 'graph');
}
function messageHTML(message, summary) {
  const ai = message.role === 'assistant', unknown = message.role === 'unknown';
  return `<div class="message ${ai ? 'ai' : unknown ? 'unknown' : ''}"><details><summary><span class="role">${unknown ? '角色未识别 · 待确认文本' : ai ? 'AI' : 'You'}${summary ? ' · 摘要' : ''}</span><span class="snippet ${summary ? 'ai-snippet' : ''}">${esc(summary || Atlas.excerpt(message.text))}</span></summary><div class="full">${esc(message.text)}</div></details><button class="locate" data-message="${esc(message.id)}">定位原消息</button></div>`;
}
function render() {
  const record = current();
  $('export').disabled = $('delete').disabled = !record;
  $('extract').disabled = !record || Boolean(extracting);
  $('cancelExtract').hidden = !extracting;
  renderProgress();
  const analysis = AtlasAI.displayAnalysis(rawRecord(), selectedBranch);
  const result = analysis?.result || null;
  if(topicSelection&&(topicSelection.key!==selectedKey||topicSelection.branchId!==selectedBranch||!result?.topics.some(t=>t.id===topicSelection.topicId))){$('topicDialog').close();topicSelection=null;}
  if (!record) {
    delete $('graph').dataset.publication;delete $('graph').dataset.context;
    $('timeline').innerHTML = '<p class="empty">打开一条 ChatGPT 对话后会自动读取。<br>切换对话时自动跟随，无需点击采集。<br>消息仅保存到本机，可随时关闭自动读取。</p>';
    $('graph').innerHTML = '<p class="empty">读取对话后，点击“抽取关系图”生成主题与关系。</p>';
    return;
  }
  const openMessages = new Set([...document.querySelectorAll('.turn details[open]')].map(n => n.closest('.message').querySelector('[data-message]')?.dataset.message));
  const ts = Atlas.turns(record.messages);
  $('timeline').innerHTML = ts.map((t, i) => {
    const a = record.annotations[t.id] || {};
    const row = result?.timeline.find(row => row.roundId === t.id), topic = result?.topics.find(n => n.id === row?.primaryTopicId);
    const title = row?.title || a.topic || '待命名主题 ' + (i + 1);
    const createdAt = (t.user || t.assistants[0] || t.unknowns?.[0])?.createdAt;
    const time = createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt).toLocaleString('zh-CN') : '';
    return `<article class="turn" id="turn-${i}" data-turn-id="${esc(t.id)}"><span class="number">${i + 1}</span><div class="heading"><div>${topic ? `<span class="topic-tag">${esc(topic.name)}</span>` : ''}<b class="${row || a.topic ? '' : 'draft'}">${esc(title)}</b>${time ? `<time class="time-label" datetime="${esc(createdAt)}">${esc(time)}</time>` : ''}${a.summary ? `<p class="summary-text">${esc(a.summary)}</p>` : ''}</div><button class="edit" data-edit="${esc(t.id)}" aria-label="编辑第 ${i + 1} 轮主题">编辑</button></div>${t.unknowns ? t.unknowns.map(m => messageHTML(m)).join('') : t.user ? messageHTML(t.user, row?.userSummary) : '<div class="message"><span class="role">You</span><p class="missing">当前采集片段缺少用户消息</p></div>'}${t.unknowns ? '' : t.assistants.length ? t.assistants.map(m => messageHTML(m, row?.assistantSummary)).join('') : '<div class="message ai"><span class="role">AI</span><p class="missing">尚未采集到回复</p></div>'}</article>`;
  }).join('');
  document.querySelectorAll('.turn details').forEach(n => { if (openMessages.has(n.closest('.message').querySelector('[data-message]')?.dataset.message)) n.open = true; });
  renderGraph(record, result);
}
function renderProgress() {
  const state=AtlasPanelState.describe(rawRecord(),selectedBranch,queueTasks);
  const time=state.time&&!Number.isNaN(Date.parse(state.time))?` · ${state.timeLabel} ${new Date(state.time).toLocaleString('zh-CN')}`:'';
  $('aiState').textContent=`AI 归纳 · ${state.label}${time}`;
  $('aiState').dataset.state=state.state;
}
function renderGraph(record, result) {
  const { nodes, edges } = result ? {
    nodes: result.topics.map(t => ({ id: t.id, label: t.name, summary: t.summary, turnIds: t.roundIds, named: true })),
    edges: result.relations.map(e => ({ ...e, turnId: e.atRoundId }))
  } : (() => { const graph = Atlas.graph(record); return { nodes: graph.nodes.map(n => ({ ...n, id: n.label })), edges: graph.edges }; })();
  if (!nodes.length) { delete $('graph').dataset.publication;delete $('graph').dataset.context;$('graph').innerHTML = '<p class="empty">暂无可读主题。</p>'; return; }
  const width = 350, height = Math.max(150, nodes.length * 92 + 25);
  const positions = new Map(nodes.map((n, i) => [n.id, { x: 44, y: 16 + i * 92 }]));
  const lines = edges.map((edge, index) => {
    const a = positions.get(edge.from), b = positions.get(edge.to);
    const back = b.y < a.y;
    const lane = back ? 294 + (index % 3) * 12 : 23 + (index % 3) * 7;
    const d = edge.type === 'flow' && Math.abs(b.y - a.y) === 92 ? `M164 ${a.y + 58} L164 ${b.y}` : `M${back ? 284 : 44} ${a.y + 29} C${lane} ${a.y + 29} ${lane} ${b.y + 29} ${back ? 284 : 44} ${b.y + 29}`;
    const type = { flow: '推进', branch: '分支', return: '回归' }[edge.type];
    const from = nodes.find(n => n.id === edge.from)?.label, to = nodes.find(n => n.id === edge.to)?.label;
    return `<path d="${d}" class="edge ${edge.type}" marker-end="url(#arrow)"><title>${esc(from)} → ${esc(to)} · ${type} · ${result ? esc(edge.reason) + (edge.inferred ? ' · 上下文推断' : ' · 有原文依据') : edge.manual ? '手动标注' : '按出现顺序推导'}</title></path>${result ? `<text class="edge-label" x="${back ? 290 : 4}" y="${(a.y + b.y) / 2 + 29}">${esc(edge.label.slice(0, 8))}</text>` : ''}`;
  }).join('');
  const html = `<div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="group" aria-label="主题关系图"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#a9b5c7"/></marker></defs>${lines}${nodes.map(n => {
    const p = positions.get(n.id), label = Atlas.excerpt(n.label, 16);
    return `<g transform="translate(${p.x},${p.y})" class="node" role="button" tabindex="0" data-topic="${esc(n.id)}" aria-label="查看主题：${esc(n.label)}"><title>${esc(n.summary || n.label)}</title><rect width="240" height="58" rx="6"/><text x="14" y="25">${esc(label)}</text><text x="14" y="44" class="small">${n.turnIds.length} 轮讨论${n.named ? '' : ' · 尚未命名'} · ${result ? '点击查看摘要与依据' : '点击定位'}</text></g>`;
  }).join('')}</svg></div><div class="legend">实线：推进　虚线：分支　点线：回归<p>${result ? '关系由模型归纳，摘录已核对原文。点击主题查看摘要、关系依据及对应轮次。' : '尚未使用 AI 抽取；当前按人工标注和出现顺序连接。'}</p></div>`;
  const identity=JSON.stringify([selectedKey,selectedBranch,html]);
  if($('graph').dataset.publication===identity)return;
  const sameContext=$('graph').dataset.context===JSON.stringify([selectedKey,selectedBranch]);
  const scroll=document.scrollingElement,top=scroll?.scrollTop;
  const wrap=$('graph').querySelector?.('.graph-wrap'),left=wrap?.scrollLeft;
  const focused=$('graph').contains?.(document.activeElement)?document.activeElement.closest?.('[data-topic]')?.dataset.topic:null;
  // One synchronous replacement; polling and partial checkpoints leave the old DOM intact.
  $('graph').innerHTML=html;
  $('graph').dataset.publication=identity;$('graph').dataset.context=JSON.stringify([selectedKey,selectedBranch]);
  if(sameContext){if(scroll&&top!==undefined)scroll.scrollTop=top;const nextWrap=$('graph').querySelector?.('.graph-wrap');if(nextWrap&&left!==undefined)nextWrap.scrollLeft=left;
    if(focused)[...$('graph').querySelectorAll('[data-topic]')].find(n=>n.dataset.topic===focused)?.focus({preventScroll:true});}
}
async function checkStatus() { try { const r=await toPage({type:'status'});if(r?.lastError)quietStatus(r.lastError); } catch { /* Routine capture status stays silent. */ } }
function edit(id) {
  const record = current(), a = record.annotations[id] || {};
  const analysis = AtlasAI.analysis(rawRecord(), selectedBranch), topicId = !analysis?.stale && analysis?.result.timeline.find(t => t.roundId === id)?.primaryTopicId;
  editTurn = id; $('topicInput').value = a.topic || analysis?.result.topics.find(t => t.id === topicId)?.name || ''; $('summaryInput').value = a.summary || ''; $('relationInput').value = a.relation || '';
  $('topicNames').innerHTML = [...new Set([...Object.values(record.annotations).map(v => v.topic).filter(Boolean), ...(analysis?.result.topics.map(t => t.name) || [])])].map(v => `<option value="${esc(v)}"></option>`).join('');
  $('editor').showModal();
}
async function sendLocate(record, payload) {
  const targetInfo = Atlas.conversation(record.url || '');
  if (!targetInfo?.key || targetInfo.key !== record.key) throw new Error('这条记录没有可验证的原网页地址。');
  const active = await activeTab();
  if (Atlas.conversation(active?.url || '')?.key === record.key) return toPage(payload);
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://gemini.google.com/*'] });
  let target = tabs.find(tab => Atlas.conversation(tab.url || '')?.key === record.key);
  if (target) {
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId && chrome.windows?.update) await chrome.windows.update(target.windowId, { focused: true });
  } else target = await chrome.tabs.create({ url: record.url, active: true });
  for (let i = 0; i < 24; i++) {
    try {
      const ready = await chrome.tabs.sendMessage(target.id, { type: 'status' });
      if (ready?.conversation?.key === record.key) return await chrome.tabs.sendMessage(target.id, payload);
    } catch { /* Wait for the newly opened conversation's content script. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('已打开原对话，但网页尚未连接完成。加载完成后请再次点击定位。');
}
async function locate(id) {
  const record = current(), grouped = Atlas.turns(record.messages).flatMap(t => [t.user, ...t.assistants, ...(t.unknowns || [])]).filter(Boolean);
  const message = grouped.find(m => m.id === id);
  if (!message) return;
  try {
    status('正在定位，必要时会自动滚动加载；操作网页可取消。');
    const target = message.segments?.find(m => m.channel === 'final') || message;
    const segments = (message.segments || [message]).map(segment => ({ ...segment, ambiguous: record.messages.filter(m => m.role === segment.role && m.text === segment.text).length > 1 }));
    const result = await sendLocate(record, { type: 'locate', key: record.key, ...message, segments, context: { inactiveBranch: selectedBranch !== 'current', pathIndex: Math.max(0, record.messages.findIndex(m => m.id === target.id)), pathNativeIds: record.messages.map(m => m.nativeId || ''), pathTexts: record.messages.map(m => m.text.slice(0, 220)) } });
    if (result?.error) throw new Error(result.error);
    status('已在原网页定位并高亮消息。');
  } catch (error) { status(error.message, true); }
}
function locateTopic(label) {
  const record = current(), analysis = AtlasAI.displayAnalysis(rawRecord(), selectedBranch);
  if (analysis) {
    const topic = analysis.result.topics.find(t => t.id === label);
    if (!topic) return;
    topicSelection = { key: selectedKey, branchId: selectedBranch, topicId:topic.id, turnIds: topic.roundIds };
    const roundNumbers = new Map(Atlas.turns(record.messages).map((t, i) => [t.id, i + 1]));
    $('topicTitle').textContent = topic.name; $('topicSummary').textContent = topic.summary;
    const evHTML = ev => ev.map(e => `<blockquote>第 ${roundNumbers.get(e.roundId)} 轮 · ${esc(e.role === 'user' ? 'You' : e.role === 'assistant' ? 'AI' : '未知角色')}<br>${esc(e.quote)}</blockquote>`).join('');
    $('topicEvidence').innerHTML = `<details open><summary>对应轮次：${topic.roundIds.map(id => roundNumbers.get(id)).join('、')}</summary>${analysis.result.timeline.filter(t => topic.roundIds.includes(t.roundId)).map(t => evHTML(t.evidence)).join('')}</details>` + analysis.result.relations.filter(e => e.from === label || e.to === label).map(e => `<details><summary>${esc(e.label)} · ${e.inferred ? '上下文推断' : '原文依据'}</summary><p>${esc(e.reason)}</p>${evHTML(e.evidence)}</details>`).join('');
    $('topicDialog').showModal(); return;
  }
  const node = Atlas.graph(record).nodes.find(n => n.label === label);
  if (!node) return;
  highlightTurns(node.turnIds);
}
function highlightTurns(turnIds) {
  const matches = [...document.querySelectorAll('.turn')].filter(n => turnIds.includes(n.dataset.turnId));
  document.querySelectorAll('.target').forEach(n => n.classList.remove('target'));
  matches.forEach(n => n.classList.add('target')); setView('timeline');
  matches[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('closeTopic').onclick = () => $('topicDialog').close();
$('topicTimeline').onclick = () => { $('topicDialog').close(); if (topicSelection?.key === selectedKey && topicSelection.branchId === selectedBranch) highlightTurns(topicSelection.turnIds); };
$('automatic').onchange = async () => {
  try { await chrome.storage.local.set({ 'atlas:settings': { autoCapture: $('automatic').checked } }); status($('automatic').checked ? '自动读取已开启，正在跟随当前对话。' : '自动读取已关闭。'); }
  catch (error) { status(error.message, true); }
};
$('diagnose').onclick = async () => {
  try {
    const result = await toPage({ type: 'diagnose' });
    if (!result || result.error) throw new Error(result?.error || '网页未响应诊断请求，请重载扩展并刷新网页。');
    const text = JSON.stringify(result, null, 2);
    $('diagnostic').textContent = text; $('diagnostic').hidden = false;
    try { await navigator.clipboard.writeText(text); status('采集诊断已复制，不含对话正文。'); }
    catch { status('诊断已显示在下方，请选中复制。不含对话正文。'); }
  } catch (error) { status(error.message, true); }
};
$('timelineTab').onclick = () => setView('timeline'); $('graphTab').onclick = () => setView('graph');
$('archive').onchange = () => { selectedKey = $('archive').value; selectedBranch = 'current'; followActive = false; render(); status('正在查看本机记录。'); };
$('cancelEdit').onclick = () => $('editor').close();
$('editForm').onsubmit = async event => {
  event.preventDefault();
  try { await request({ type: 'annotate', key: selectedKey, turnId: editTurn, topic: $('topicInput').value, summary: $('summaryInput').value, relation: $('relationInput').value }); $('editor').close(); await load(); status('主题已保存到本机。'); }
  catch (error) { status(error.message, true); }
};
document.addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit]'), message = event.target.closest('[data-message]'), node = event.target.closest('[data-topic]');
  if (editButton) edit(editButton.dataset.edit);
  if (message) locate(message.dataset.message);
  if (node) locateTopic(node.dataset.topic);
});
document.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target.matches('[data-topic]')) { event.preventDefault(); locateTopic(event.target.dataset.topic); } });
$('export').onclick = () => {
  const record = rawRecord(); if (!record) return;
  const blob = new Blob([JSON.stringify({ format: 'topic-atlas', version: 1, exportedAt: new Date().toISOString(), conversation: record }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'topic-atlas-' + Atlas.hash(record.key) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('delete').onclick = async () => {
  const record = current(); if (!record || !confirm('删除这条浏览器缓存记录及主题标注，并取消其任务、暂停自动读取？文件夹中的历史备份会保留。请先导出需要保留的内容。')) return;
  try {
    const page = await toPage({ type: 'status' }).catch(() => null);
    if (page?.conversation?.key === record.key) await toPage({ type: 'stop' });
    await request({ type: 'delete', key: record.key }); await load(); await checkStatus(); status('本机记录已删除；原平台对话不受影响。');
  } catch (error) { status(error.message, true); }
};
let updateTimer;
chrome.storage.onChanged.addListener((changes, area) => { if (area !== 'local') return; clearTimeout(updateTimer); updateTimer = setTimeout(() => load(followActive).catch(e => quietStatus(e.message)), 150); });
chrome.tabs.onActivated.addListener(() => { followActive = true; load(true).then(checkStatus).catch(e => quietStatus(e.message)); });
chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && (change.url || change.status === 'complete')) { followActive = true; load(true).then(checkStatus).catch(e => quietStatus(e.message)); } });
chrome.runtime.onMessage.addListener(message => { if (message.type === 'capture-error' && message.key === selectedKey) quietStatus(message.error); });
async function refreshConfig() { aiConfig=await request({type:'ai-get-config'}); }
$('settingsButton').onclick=()=>chrome.runtime.openOptionsPage();
$('extract').onclick = async () => {
  if (directRequest) return;
  directRequest=true;
  try {
    await refreshConfig();
    const config=aiConfig.profiles[aiConfig.provider];
    if(!config.hasKey||!config.model){await chrome.runtime.openOptionsPage();return;}
    const r=await request({type:'queue-start',key:selectedKey,branchId:selectedBranch});
    status(`已加入后台队列 · ${r.total} 轮。可继续聊天或切换页面。`);
    await resumeJob();
  } catch(e){status(e.message,true);} finally{directRequest=false;}
};
$('cancelExtract').onclick = async () => {
  if(!extracting)return;
  try{await request({type:'queue-action',id:extracting.id,action:'cancel'});status('已请求取消，已完成分段仍保留。');await resumeJob();}catch(e){status(e.message,true);}
};
let lastQueueState='';
async function resumeJob() {
  const r=await request({type:'queue-list'});
  const active=r.tasks.filter(t=>['queued','running'].includes(t.state));
  const local=active.find(t=>t.key===selectedKey&&t.branchId===selectedBranch);
  extracting=local||null;queueTasks=r.tasks;
  $('extract').disabled=!rawRecord()||!!local;$('cancelExtract').hidden=!local;
  const needsAttention=Boolean(r.library.error||r.library.connected&&!r.library.granted||r.notice||r.tasks.some(t=>['error','interrupted'].includes(t.state)));
  $('settingsButton').classList.toggle('needs-attention',needsAttention);
  $('settingsButton').setAttribute('aria-label',needsAttention?'设置，有待处理事项':'设置');
  $('settingsButton').title=needsAttention?'设置中有待处理事项':'设置';
  const currentTask=r.tasks.find(t=>t.key===selectedKey&&t.branchId===selectedBranch);
  const next=JSON.stringify([currentTask?.id,currentTask?.state,currentTask?.processed]);
  if(lastQueueState&&next!==lastQueueState){await load();if(currentTask?.state==='done')status(`关系图已保存 · ${currentTask.processed} 轮 · 本次调用 ${currentTask.requests} 次 API。`);}
  lastQueueState=next;renderProgress();
}
setInterval(()=>resumeJob().catch(e=>quietStatus(e.message)),2500);
load(true).then(checkStatus).then(refreshConfig).then(resumeJob).catch(error=>quietStatus(error.message));
