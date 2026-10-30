'use strict';
const $ = id => document.getElementById(id);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const launch=typeof location!=='undefined'?new URL(location.href).searchParams:null;
const standaloneGraph=!!launch?.get('conversation');
let catalog=[],loadEpoch=0,bodyEpoch=0,bodyContext='',timelineRows=[],timelineAnalysis=null;
let timelineQuery='',timelineNumbers=new Map();const openRounds=new Set();
const bodyPages=new Map(),pendingBodies=new Map(),openBodies=new Set(),bodyOffsets=new Map();
let messageRoundIds=new Map(),messageMetadata=new Map();
let messageGroups=new Map();
let records = [], selectedKey = launch?.get('conversation')||'', view = launch?.get('view')==='graph'?'graph':'timeline', editTurn = null, tabId = null, selectedBranch = launch?.get('branch')||'current', followActive = !standaloneGraph;
let aiConfig = null, extracting = null, topicSelection = null, directRequest = false;
let queueTasks = [];
let graphModel=null, graphUI={selected:null,edge:null,query:'',returns:false,x:0,y:0,scale:1,viewport:false}, timelineSelection=null;
let statusTimer;
const rawRecord = () => records.find(r => r.key === selectedKey);
const current = () => {
  const record = rawRecord();
  const branch = record?.branches?.find(b => b.id === selectedBranch);
  if (!record?.allMessages || !branch) return record?{...record,messages:Atlas.answerMessages(record.messages)}:record;
  const byId = new Map(record.allMessages.map(m => [m.id, m]));
  return { ...record, messages:Atlas.answerMessages(branch.messageIds.map(id => byId.get(id)).filter(Boolean)) };
};
function status(text, error = false) { clearTimeout(statusTimer); $('status').hidden=!error; $('status').textContent=error?text:''; $('status').classList.toggle('error',error); if(error)statusTimer=setTimeout(()=>{$('status').hidden=true;},8000); }
function quietStatus(text) { $('settingsButton').title='设置 · '+text; }
async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
async function request(message) { const result = await chrome.runtime.sendMessage(message); if (result?.error) throw new Error(result.error); return result; }
async function toPage(message) {
  const tab = await activeTab();
  if (!tab?.id || !Atlas.conversation(tab.url || '')) throw new Error('请先切换到 ChatGPT、DeepSeek 或 Gemini 对话网页。');
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
  const epoch=++loadEpoch;
  if(!rawRecord())$('timeline').innerHTML='<p class="empty">正在读取本地目录；首次升级需要建立显示索引…</p>';
  const listing=await request({type:'view-list'});
  if(epoch!==loadEpoch)return;
  catalog=listing.conversations||[];
  const settings=await chrome.storage.local.get('atlas:settings');
  $('automatic').checked=settings['atlas:settings']?.autoCapture!==false;
  const tab=await activeTab();tabId=tab?.id;const info=Atlas.conversation(tab?.url||'');
  if(epoch!==loadEpoch)return;
  if(followTab&&catalog.some(r=>r.key===info?.key)){if(selectedKey!==info.key)selectedBranch='current';selectedKey=info.key;}
  if(!catalog.some(r=>r.key===selectedKey)){selectedKey=catalog[0]?.key||'';selectedBranch='current';}
  $('archive').innerHTML=catalog.length?catalog.map(r=>`<option value="${esc(r.key)}">${esc(r.platform)} · ${esc(r.title)}</option>`).join(''):'<option value="">选择本机对话记录</option>';
  $('archive').value=selectedKey;
  let record=null;
  if(selectedKey){
    try{record=(await request({type:'view-get',key:selectedKey,branchId:selectedBranch})).record;}
    catch(error){if(epoch!==loadEpoch)return;if(selectedBranch==='current')throw error;selectedBranch='current';record=(await request({type:'view-get',key:selectedKey,branchId:selectedBranch})).record;}
  }
  if(epoch!==loadEpoch)return;
  const context=JSON.stringify([selectedKey,selectedBranch]);
  if(bodyContext!==context){bodyEpoch++;bodyPages.clear();pendingBodies.clear();openBodies.clear();bodyOffsets.clear();bodyContext=context;openRounds.clear();timelineQuery='';$('timelineSearch').value='';}
  const previous=rawRecord();records=record?[record]:[];
  if(previous?.renderRevision&&record?.renderRevision===previous.renderRevision){renderProgress();return;}
  render();setView(view);
}
const timelineWindow=AtlasTimeline.create($('timeline'),{
  renderRow:rowHTML,
  onUnmount(ids){const removed=new Set(ids);for(const cache of [bodyPages,pendingBodies])for(const key of cache.keys())if(removed.has(messageRoundIds.get(JSON.parse(key)[1])))cache.delete(key);},
  onMount(){for(const shell of $('timeline').querySelectorAll?.('details[data-round-shell]')||[])if(openRounds.has(shell.dataset.roundShell))shell.open=true;for(const details of $('timeline').querySelectorAll?.('details[data-body]')||[])if(openBodies.has(details.dataset.body)&&!details.open){details.open=true;loadBodyPage(details,bodyOffsets.get(details.dataset.body)||0);}}
});
function rowHTML(t,i){
  i=timelineNumbers.get(t.id)??i;const record=current(),result=timelineAnalysis;
  const a=record.annotations?.[t.id]||{},row=result?.timeline.find(row=>row.roundId===t.id),topic=result?.topics.find(n=>n.id===row?.primaryTopicId);
  const title=row?.title||a.topic||'待命名标题 '+(i+1),createdAt=(t.user||t.assistants[0]||t.unknowns?.[0])?.createdAt;
  const time=createdAt&&!Number.isNaN(Date.parse(createdAt))?new Date(createdAt).toLocaleString('zh-CN'):'';
  return `<article class="turn${timelineSelection?.key===selectedKey&&timelineSelection.branchId===selectedBranch&&timelineSelection.turnIds.includes(t.id)?' target':''}" id="turn-${i}" data-turn-id="${esc(t.id)}" data-window-index="${i}" aria-posinset="${i+1}" aria-setsize="-1"><span class="number">${i+1}</span><details class="round-shell" data-round-shell="${esc(t.id)}"${openRounds.has(t.id)?' open':''}><summary class="heading"><div>${topic?`<span class="topic-tag">${esc(topic.name)}</span>`:''}<b class="${row||a.topic?'':'draft'}">${esc(title)}</b>${time?`<time class="time-label" datetime="${esc(createdAt)}">${esc(time)}</time>`:''}${a.summary?`<p class="summary-text">${esc(a.summary)}</p>`:''}</div><button class="edit" data-edit="${esc(t.id)}" aria-label="编辑第 ${i+1} 轮主题">编辑</button><span class="round-toggle" aria-hidden="true">＋</span></summary><div class="round-messages">${t.unknowns?t.unknowns.map(m=>messageHTML(m)).join(''):t.user?messageHTML(t.user,row?.userSummary):'<div class="message"><span class="role">You</span><p class="missing">当前采集片段缺少用户消息</p></div>'}${t.unknowns?'':t.assistants.length?t.assistants.map(m=>messageHTML(m,row?.assistantSummary)).join(''):'<div class="message ai"><span class="role">AI</span><p class="missing">尚未采集到回复</p></div>'}</div></details></article>`;
}
async function loadBodyPage(details,offset){
  const id=details.dataset.body,message=messageGroups.get(id),record=current();if(!message||!record||!details.open)return;
  const refs=(message.segments||[message]).map(m=>messageMetadata.get(m.id)?.bodyRef);
  bodyOffsets.set(id,offset);
  const target=details.querySelector('.full'),nav=details.querySelector('.body-pages'),epoch=bodyEpoch,key=JSON.stringify([bodyContext,id,offset,refs]);
  if(!target)return;
  try{
    target.textContent='正在读取本地正文…';
    let page=bodyPages.get(key);
    if(!page){
      if(!pendingBodies.has(key))pendingBodies.set(key,request({type:'view-body',key:record.key,branchId:selectedBranch,revision:record.revision,ids:(message.segments||[message]).map(m=>m.id),bodyRefs:refs,offset}));
      const pending=pendingBodies.get(key);page=await pending;if(pendingBodies.get(key)===pending)pendingBodies.delete(key);
      if(epoch!==bodyEpoch||!details.open||details.isConnected===false)return;
      bodyPages.set(key,page);while(bodyPages.size>4)bodyPages.delete(bodyPages.keys().next().value);
    }
    if(epoch!==bodyEpoch)return;
    target.textContent=page.text;
    if(nav)nav.innerHTML=page.total>16384?`${page.offset>0?`<button data-body-page="${Math.max(0,page.offset-16384)}">上一段</button>`:''}<span>正文 ${page.offset+1}–${page.end} / ${page.total} 字符</span>${page.end<page.total?`<button data-body-page="${page.end}">下一段</button>`:''}`:'';
    timelineWindow.measure();
  }catch(error){if(epoch===bodyEpoch)target.textContent=error.message;}
}
$('timeline').addEventListener('toggle',event=>{
  const details=event.target;
  if(details.matches?.('details[data-round-shell]')){if(details.open)openRounds.add(details.dataset.roundShell);else openRounds.delete(details.dataset.roundShell);timelineWindow.measure();return;}
  if(!details.matches?.('details[data-body]'))return;
  if(details.open){openBodies.add(details.dataset.body);loadBodyPage(details,bodyOffsets.get(details.dataset.body)||0);}
  else{openBodies.delete(details.dataset.body);bodyOffsets.delete(details.dataset.body);bodyPages.clear();details.querySelector('.full').textContent='';details.querySelector('.body-pages').innerHTML='';timelineWindow.measure();}
},true);
document.addEventListener('scroll',()=>timelineWindow.scroll(),{passive:true});
if(typeof globalThis.addEventListener==='function')globalThis.addEventListener('resize',()=>timelineWindow.scroll(),{passive:true});
function setView(next) {
  view = next;$('timelineToolbar').hidden=view!=='timeline';timelineWindow.activate(view==='timeline'); $('timeline').hidden = view !== 'timeline'; $('graph').hidden = view !== 'graph';
  $('timelineTab').setAttribute('aria-selected', view === 'timeline'); $('graphTab').setAttribute('aria-selected', view === 'graph');
  if(view==='graph'){if(current())renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);if(!graphUI.viewport)fitGraph();else graphTransform();}
}
function messageHTML(message, summary) {
  const ai=message.role==='assistant',unknown=message.role==='unknown';
  return `<div class="message ${ai?'ai':unknown?'unknown':''}"><details data-body="${esc(message.id)}" data-body-references="${esc((message.segments||[message]).map(m=>messageMetadata.get(m.id)?.bodyHash||m.bodyHash||'').join('|'))}"><summary><span class="role">${unknown?'角色未识别 · 待确认文本':ai?'AI':'You'}${summary?' · 摘要':''}</span><span class="snippet ${summary?'ai-snippet':''}">${esc(Atlas.excerpt(summary||message.text,240))}</span></summary><div class="full"></div><div class="body-pages"></div></details><button class="locate" data-message="${esc(message.id)}">定位原消息</button></div>`;
}
function render() {
  const record = current();
  $('export').disabled = $('delete').disabled = !record;
  $('extract').disabled = !record || Boolean(extracting);
  $('cancelExtract').hidden = !extracting;
  renderProgress();
  const analysis = AtlasAI.displayAnalysis(rawRecord(), selectedBranch);
  const result = analysis?.result || null;
  if(topicSelection&&(topicSelection.key!==selectedKey||topicSelection.branchId!==selectedBranch||(result&&!result.topics.some(t=>t.id===topicSelection.topicId)))){topicSelection=null;graphUI.selected=null;graphUI.edge=null;}
  if (!record) {
    timelineWindow.clear();messageGroups.clear();
    delete $('graph').dataset.publication;delete $('graph').dataset.context;
    $('timeline').innerHTML = '<p class="empty">打开一条 ChatGPT 对话后会自动读取。<br>切换对话时自动跟随，无需点击采集。<br>消息仅保存到本机，可随时关闭自动读取。</p>';
    $('graph').innerHTML = '<p class="empty">读取对话后，点击“抽取关系图”生成主题与关系。</p>';
    return;
  }
  timelineRows=Atlas.turns(record.messages);timelineAnalysis=result;
  messageMetadata=new Map(record.messages.map(m=>[m.id,m]));messageRoundIds=new Map();
  for(const t of timelineRows)for(const m of [t.user,...t.assistants,...(t.unknowns||[])].filter(Boolean))messageRoundIds.set(m.id,t.id);
  messageGroups=new Map(timelineRows.flatMap(t=>[t.user,...t.assistants,...(t.unknowns||[])].filter(Boolean)).map(m=>[m.id,m]));
  timelineWindow.activate(view==='timeline');
  timelineNumbers=new Map(timelineRows.map((t,i)=>[t.id,i]));applyTimelineFilter();
  if(view==='graph')renderGraph(record,result);
}
function applyTimelineFilter(){
  const q=timelineQuery.trim().toLowerCase(),record=current();
  const rows=q?timelineRows.filter(t=>{
    const row=timelineAnalysis?.timeline.find(r=>r.roundId===t.id),topic=timelineAnalysis?.topics.find(n=>n.id===row?.primaryTopicId),a=record?.annotations?.[t.id];
    return [row?.title,topic?.name,row?.userSummary,row?.assistantSummary,a?.topic,a?.summary,...[t.user,...t.assistants,...(t.unknowns||[])].filter(Boolean).map(m=>m.text)].filter(Boolean).join(' ').toLowerCase().includes(q);
  }):timelineRows;
  timelineWindow.set(rows,JSON.stringify([selectedKey,selectedBranch,timelineQuery]));$('timelineCount').textContent=q?rows.length+' / '+timelineRows.length+' 轮':'按轮次排列';
}
$('timelineSearch').addEventListener('input',event=>{if(event.isComposing)return;timelineQuery=event.target.value;applyTimelineFilter();});
$('timelineSearch').addEventListener('compositionend',event=>{timelineQuery=event.target.value;applyTimelineFilter();});
$('timelineReset').onclick=()=>{timelineQuery='';$('timelineSearch').value='';applyTimelineFilter();};
function renderProgress() {
  const state=AtlasPanelState.describe(rawRecord(),selectedBranch,queueTasks);
  const time=state.time&&!Number.isNaN(Date.parse(state.time))?` · ${state.timeLabel} ${new Date(state.time).toLocaleString('zh-CN')}`:'';
  $('aiState').textContent=`AI 归纳 · ${state.label}${time}`;
  $('aiState').dataset.state=state.state;
}
function renderGraph(record,result) {
  if(!record)return;
  const host=$('graph'),context=JSON.stringify([selectedKey,selectedBranch]);
  const sameContext=host.dataset.context===context;
  if(!sameContext)graphUI={selected:null,edge:null,query:'',returns:false,x:0,y:0,scale:1,viewport:false};
  graphModel=AtlasGraphView.model(record,result,Atlas);
  if(!graphModel.nodes.length){delete host.dataset.publication;delete host.dataset.context;host.innerHTML='<p class="empty">暂无可读主题。</p>';return;}
  if(!graphModel.byId.has(graphUI.selected)){graphUI.selected=null;graphUI.edge=null;}
  if(!graphModel.frontiers.nodes.some(d=>d.id===graphUI.frontier))graphUI.frontier=null;
  graphUI.tasks=record.directionTasks?.[selectedBranch]||{};
  const html=AtlasGraphView.render(graphModel,graphUI,selectedKey,selectedBranch),identity=JSON.stringify([context,record.revision||Atlas.hash(html),graphUI.selected,graphUI.edge,graphUI.query,graphUI.returns,graphUI.frontier]);
  if(host.dataset.publication===identity)return;
  const scroll=document.scrollingElement,top=scroll?.scrollTop;
  const search=host.querySelector?.('[data-graph-search]'),searchFocused=search&&document.activeElement===search,caret=search?.selectionStart;
  // Replace only on actual publication or explicit interaction, preserving the old
  // graph through polling, checkpoints, failures and appended source messages.
  host.innerHTML=html;host.dataset.publication=identity;host.dataset.context=context;
  if(sameContext&&scroll&&top!==undefined)scroll.scrollTop=top;
  if(searchFocused){const input=host.querySelector?.('[data-graph-search]');input?.focus({preventScroll:true});try{input?.setSelectionRange(caret,caret);}catch{}}
  if(view==='graph'&&!graphUI.viewport)fitGraph();else graphTransform();
}
function graphTransform(){const world=$('graph').querySelector?.('.graph-world');if(world)world.style.transform=`translate(${graphUI.x}px,${graphUI.y}px) scale(${graphUI.scale})`;}
function fitGraph(){const stage=$('graph').querySelector?.('.graph-stage'),r=stage?.getBoundingClientRect?.();if(!graphModel||!r?.width||!r.height)return;graphUI.scale=Math.max(.08,Math.min((r.width-20)/graphModel.width,(r.height-30)/graphModel.height,1));graphUI.x=(r.width-graphModel.width*graphUI.scale)/2;graphUI.y=(r.height-graphModel.height*graphUI.scale)/2;graphUI.viewport=true;graphTransform();}
function zoomGraph(factor,x,y){const r=$('graph').querySelector?.('.graph-stage')?.getBoundingClientRect?.();if(!r)return;x=x??r.width/2;y=y??r.height/2;const next=Math.max(.08,Math.min(2,graphUI.scale*factor));graphUI.x=x-(x-graphUI.x)*next/graphUI.scale;graphUI.y=y-(y-graphUI.y)*next/graphUI.scale;graphUI.scale=next;graphUI.viewport=true;graphTransform();}
function graphAction(action){
  if(action==='expand')return chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'?view=graph&conversation='+encodeURIComponent(selectedKey)+'&branch='+encodeURIComponent(selectedBranch),active:true}).catch(error=>status(error.message,true));
  if(action==='fit')return fitGraph();
  if(action==='in'||action==='out')return zoomGraph(action==='in'?1.25:.8);
  if(action==='canvas')return $('graph').querySelector?.('.graph-stage')?.scrollIntoView?.({behavior:'smooth',block:'center'});
  graphUI.selected=null;graphUI.edge=null;graphUI.frontier=null;topicSelection=null;
  if(action==='reset'){graphUI.query='';graphUI.returns=false;}
  renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);
  if(action==='reset')fitGraph();
}
function openGraphRound(id,key,branch){
  if(key!==selectedKey||branch!==selectedBranch){status('对话或分支已切换，请重新选择标题。',true);return;}
  if(!graphModel?.timeline.some(r=>r.roundId===id)||!Atlas.turns(current()?.messages||[]).some(t=>t.id===id)){status('对应轮次尚未读取，无法定位时间线。',true);return;}
  highlightTurns([id]);
}
async function checkStatus() { try { const r=await toPage({type:'status'});if(r?.lastError)quietStatus(r.lastError); } catch { /* Routine capture status stays silent. */ } }
function edit(id) {
  const record = current(); if(!record)return;
  const a = record.annotations[id] || {};
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
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://gemini.google.com/*', 'https://chat.deepseek.com/*'] });
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
  const record = current();if(!record)return;
  const grouped = Atlas.turns(record.messages).flatMap(t => [t.user, ...t.assistants, ...(t.unknowns || [])]).filter(Boolean);
  let message = grouped.find(m => m.id === id);
  if (!message) return;
  try {
    status('正在定位，必要时会自动滚动加载；操作网页可取消。');
    const full=await request({type:'view-body',key:record.key,branchId:selectedBranch,revision:record.revision,ids:(message.segments||[message]).map(m=>m.id),bodyRefs:(message.segments||[message]).map(m=>messageMetadata.get(m.id)?.bodyRef),full:true});
    message={...message,text:full.text,segments:full.segments};
    const target = message.segments?.find(m => m.channel === 'final') || message;
    const segments = (message.segments || [message]).map(segment => ({ ...segment, ambiguous: record.messages.filter(m => m.role === segment.role && m.bodyHash === segment.bodyHash).length > 1 }));
    const result = await sendLocate(record, { type: 'locate', key: record.key, ...message, segments, context: { inactiveBranch: selectedBranch !== 'current', pathIndex: Math.max(0, record.messages.findIndex(m => m.id === target.id)), pathNativeIds: record.messages.map(m => m.nativeId || ''), pathTexts: record.messages.map(m => m.text.slice(0, 220)) } });
    if (result?.error) throw new Error(result.error);
    status('已在原网页定位并高亮消息。');
  } catch (error) { status(error.message, true); }
}
function locateTopic(id) {
  if(!current()||!graphModel?.byId.has(id))return;
  graphUI.selected=id;graphUI.edge=null;graphUI.frontier=null;
  topicSelection={key:selectedKey,branchId:selectedBranch,topicId:id,turnIds:graphModel.byId.get(id).turnIds};
  renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);
  $('graph').querySelector?.('.graph-detail')?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
}
function selectFrontier(id){
  const d=graphModel?.frontiers.nodes.find(d=>d.id===id);if(!d)return;
  graphUI.frontier=id;graphUI.selected=d.parentTopicId;graphUI.edge=null;
  renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);
  const box=$('graph').querySelector?.('.graph-stage')?.getBoundingClientRect?.(),p=graphModel.frontiers.ends.get(id);
  if(box&&p){graphUI.scale=Math.max(.8,graphUI.scale);graphUI.x=box.width/2-(p.x+p.width/2)*graphUI.scale;graphUI.y=box.height/2-(p.y+p.height/2)*graphUI.scale;graphUI.viewport=true;graphTransform();}
}
async function setDirectionTask(id,next){
  const record=current(),d=graphModel?.frontiers.nodes.find(d=>d.id===id);if(!record||!d)return;
  const buttonKey=selectedKey,branch=selectedBranch;
  await request({type:'direction-set',key:buttonKey,branchId:branch,id,identity:AtlasDirections.identity(d),status:next});
  if(buttonKey===selectedKey&&branch===selectedBranch)await load();
}
function highlightTurns(turnIds) {
  timelineQuery='';$('timelineSearch').value='';for(const id of turnIds)openRounds.add(id);applyTimelineFilter();
  timelineSelection={key:selectedKey,branchId:selectedBranch,turnIds:[...turnIds]};
  setView('timeline');timelineWindow.reveal(turnIds[0]);
  const matches=[...document.querySelectorAll('.turn')].filter(n=>turnIds.includes(n.dataset.turnId));
  document.querySelectorAll('.target').forEach(n=>n.classList.remove('target'));
  matches.forEach(n=>{n.classList.add('target');const shell=n.querySelector?.('details[data-round-shell]');if(shell)shell.open=true;});setView('timeline');
  matches[0]?.scrollIntoView({behavior:'smooth',block:'center'});
}
$('automatic').onchange = async () => {
  try { await chrome.storage.local.set({ 'atlas:settings': { autoCapture: $('automatic').checked } }); status($('automatic').checked ? '自动读取已开启，正在跟随当前对话。' : '自动读取已关闭。'); }
  catch (error) { status(error.message, true); }
};
$('diagnose').onclick = async () => {
  $('diagnose').disabled=true;
  try {
    const tab=await activeTab(),info=Atlas.conversation(tab?.url||'');
    let result;
    try {result=await toPage({ type: 'diagnose' });}catch(error){result={pageDiagnosticError:error.message};}
    if (!result) result={pageDiagnosticError:'网页未响应常规诊断请求。'};
    let markers;
    if(info?.platform==='ChatGPT'){
      try{markers=(await request({type:'diagnose-message-markers',tabId:tab.id})).messageMarkers;}
      catch(error){markers={error:error.message};}
    }else markers={error:'消息标记诊断需要先打开 ChatGPT 的一条已保存对话。'};
    const text = JSON.stringify({...result,messageMarkers:markers}, null, 2);
    $('diagnostic').textContent = text; $('diagnostic').hidden = false;
    try { await navigator.clipboard.writeText(text); status('采集诊断已复制，不含对话正文。'); }
    catch { status('诊断已显示在下方，请选中复制。不含对话正文。'); }
  } catch (error) { status(error.message, true); }
  finally { $('diagnose').disabled=false; }
};
$('timelineTab').onclick = () => setView('timeline'); $('graphTab').onclick = () => setView('graph');
$('archive').onchange = () => { selectedKey = $('archive').value; selectedBranch = 'current'; followActive = false; load().catch(e=>status(e.message,true)); };
$('cancelEdit').onclick = () => $('editor').close();
$('editForm').onsubmit = async event => {
  event.preventDefault();
  try { await request({ type: 'annotate', key: selectedKey, turnId: editTurn, topic: $('topicInput').value, summary: $('summaryInput').value, relation: $('relationInput').value }); $('editor').close(); await load(); status('主题已保存到本机。'); }
  catch (error) { status(error.message, true); }
};
document.addEventListener('click', event => {
  const pageButton=event.target.closest('[data-body-page]');if(pageButton){const details=pageButton.closest('details[data-body]');loadBodyPage(details,Number(pageButton.dataset.bodyPage));return;}
  const directionAction=event.target.closest('[data-direction-action]'),frontier=event.target.closest('[data-frontier]');
  if(directionAction){setDirectionTask(directionAction.dataset.directionId,directionAction.dataset.directionAction).catch(error=>status(error.message,true));return;}
  if(frontier){selectFrontier(frontier.dataset.frontier);return;}
  const action=event.target.closest('[data-graph-action]'),round=event.target.closest('[data-round]'),edge=event.target.closest('[data-graph-edge]');
  if(action){graphAction(action.dataset.graphAction);return;}
  if(round){openGraphRound(round.dataset.round,round.dataset.record,round.dataset.branch);return;}
  if(edge){const e=graphModel?.edges.find(e=>e.index===Number(edge.dataset.graphEdge));if(e){graphUI.frontier=null;graphUI.selected=e.from;graphUI.edge=e.index;renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);}return;}
  const editButton = event.target.closest('[data-edit]'), message = event.target.closest('[data-message]'), node = event.target.closest('[data-topic]');
  if (editButton) {event.preventDefault?.();edit(editButton.dataset.edit);}
  if (message) locate(message.dataset.message);
  if (node) locateTopic(node.dataset.topic);
});
document.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target.matches('[data-topic]')) { event.preventDefault(); locateTopic(event.target.dataset.topic); } });
$('export').onclick = async () => {
  if(!rawRecord())return;
  let record;try{record=(await request({type:'view-export',key:selectedKey})).record;}catch(error){status(error.message,true);return;}
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
function handleViewChanges(changes){
  if(changes['atlas:view-error']?.newValue)status('本地显示索引更新失败：'+changes['atlas:view-error'].newValue,true);
  if(changes['atlas:queue-summary']||changes['atlas:library']||changes['atlas:queue-error'])resumeJob().catch(e=>quietStatus(e.message));
  if(changes['atlas:settings'])chrome.storage.local.get('atlas:settings').then(s=>{$('automatic').checked=s['atlas:settings']?.autoCapture!==false;});
  if(changes['atlas:view-catalog']){
    const listing=changes['atlas:view-catalog'].newValue||{};
    clearTimeout(updateTimer);updateTimer=setTimeout(async()=>{
      try{
        const tab=followActive?await activeTab():null,active=Atlas.conversation(tab?.url||'');
        if(!rawRecord()||!listing[selectedKey]||listing[selectedKey].revision!==rawRecord().revision||active&&active.key!==selectedKey&&listing[active.key]){await load(followActive);return;}
        catalog=Object.values(listing).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
        $('archive').innerHTML=catalog.map(r=>`<option value="${esc(r.key)}">${esc(r.platform)} · ${esc(r.title)}</option>`).join('');$('archive').value=selectedKey;
      }catch(error){quietStatus(error.message);}
    },150);
  }
 }
let updatePort=null;
function connectUpdates(){
  if(!chrome.runtime.connect||updatePort)return;
  try{
    const port=chrome.runtime.connect({name:'atlas-ui'});updatePort=port;
    port.onMessage.addListener(message=>{if(message.type==='view-notice')handleViewChanges(message.changes||{});});
    port.onDisconnect.addListener(()=>{if(updatePort===port)updatePort=null;setTimeout(connectUpdates,500);});
  }catch(error){updatePort=null;quietStatus('轻量通知暂不可用，将检查本地目录更新。');}
}
connectUpdates();
// Fallback after worker restarts: poll the small catalog, never raw storage events.
setInterval(()=>request({type:'view-list'}).then(r=>handleViewChanges({'atlas:view-catalog':{newValue:Object.fromEntries((r.conversations||[]).map(c=>[c.key,c]))}})).catch(e=>quietStatus(e.message)),15000);
chrome.tabs.onActivated.addListener(() => { if(standaloneGraph)return;followActive = true; load(true).then(checkStatus).catch(e => quietStatus(e.message)); });
chrome.tabs.onUpdated.addListener((id, change) => { if(!standaloneGraph&&id === tabId && (change.url || change.status === 'complete')) { followActive = true; load(true).then(checkStatus).catch(e => quietStatus(e.message)); } });
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
  const r=await request({type:'queue-summary'});
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
  if(lastQueueState&&next!==lastQueueState){if(currentTask?.state==='done')status(`关系图已保存 · ${currentTask.processed} 轮 · 本次调用 ${currentTask.requests} 次 API。`);}
  lastQueueState=next;renderProgress();
}
setInterval(()=>resumeJob().catch(e=>quietStatus(e.message)),2500);
load(true).then(checkStatus).then(refreshConfig).then(resumeJob).catch(error=>status(error.message,true));

let graphComposing=false;
$('graph').addEventListener('compositionstart',event=>{if(event.target.matches('[data-graph-search]'))graphComposing=true;});
$('graph').addEventListener('compositionend',event=>{if(!event.target.matches('[data-graph-search]'))return;graphComposing=false;graphUI.query=event.target.value;renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);});
$('graph').addEventListener('input',event=>{if(graphComposing||event.isComposing||!event.target.matches('[data-graph-search]'))return;graphUI.query=event.target.value;renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);});
$('graph').addEventListener('change',event=>{if(!event.target.matches('[data-graph-returns]'))return;graphUI.returns=event.target.checked;renderGraph(current(),AtlasAI.displayAnalysis(rawRecord(),selectedBranch)?.result||null);});
$('graph').addEventListener('wheel',event=>{const stage=event.target.closest('.graph-stage');if(!stage)return;event.preventDefault();const r=stage.getBoundingClientRect();zoomGraph(Math.exp(-event.deltaY*.0015),event.clientX-r.left,event.clientY-r.top);},{passive:false});
let graphDrag=null,graphSuppressClick=false;
$('graph').addEventListener('pointerdown',event=>{graphSuppressClick=false;const stage=event.target.closest('.graph-stage');if(!stage||event.target.closest('button,[data-graph-edge]')||event.target.closest('[data-frontier]')||event.button!==undefined&&event.button!==0||event.isPrimary===false)return;event.preventDefault?.();graphDrag={x:event.clientX,y:event.clientY,originX:graphUI.x,originY:graphUI.y,pointerId:event.pointerId,stage,moved:false};stage.classList?.add('is-panning');stage.setPointerCapture(event.pointerId);});
$('graph').addEventListener('pointermove',event=>{if(!graphDrag||event.pointerId!==undefined&&event.pointerId!==graphDrag.pointerId)return;event.preventDefault?.();const dx=event.clientX-graphDrag.x,dy=event.clientY-graphDrag.y;if(!graphDrag.moved&&Math.hypot(dx,dy)<4)return;graphDrag.moved=true;graphUI.x=graphDrag.originX+dx;graphUI.y=graphDrag.originY+dy;graphUI.viewport=true;graphTransform();});
function endGraphDrag(event){if(!graphDrag||event?.pointerId!==undefined&&event.pointerId!==graphDrag.pointerId)return;const drag=graphDrag;graphDrag=null;graphSuppressClick=drag.moved&&event?.type!=='pointercancel';drag.stage.classList?.remove('is-panning');if(drag.stage.hasPointerCapture?.(drag.pointerId))drag.stage.releasePointerCapture(drag.pointerId);}
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('graph').addEventListener(name,endGraphDrag);
$('graph').addEventListener('click',event=>{if(!graphSuppressClick)return;graphSuppressClick=false;event.preventDefault();event.stopPropagation();},true);
for(const name of ['selectstart','dragstart'])$('graph').addEventListener(name,event=>{if(event.target.closest('.graph-stage'))event.preventDefault();});
