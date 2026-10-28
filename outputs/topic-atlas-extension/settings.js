'use strict';
const $=id=>document.getElementById(id), escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const send=async m=>{const r=await chrome.runtime.sendMessage(m);if(r?.error)throw new Error(r.error);return r;};
function report(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
const labels={queued:'排队中',running:'整理中',done:'已完成',interrupted:'已中断',error:'失败，已暂停',cancelled:'已取消'};
function historyDetails(h){
  if(!h)return '';
  return `<details class="history-review"><summary>历史读取：目录 ${Number(h.coveredPages)||0}/${Number(h.pageTotal)||0} 页 · ${Number(h.catalogTotal)||0} 个主题 · 补查 ${Number(h.supplements)||0}/2 次</summary><p>已选主题：${escapeHTML((h.topicIds||[]).join('、')||'无')}<br>原文轮次：${escapeHTML((h.roundIds||[]).join('、')||'未请求')}<br>选择请求：${Number(h.requests)||0} 次</p>${(h.reads||[]).map(r=>`<p>${escapeHTML(r.stage)}${r.page?' · 第 '+Number(r.page)+' 页':''} · ${escapeHTML(r.reason||'')}<br>查看目录：${escapeHTML((r.catalogIds||[]).join('、')||'—')}<br>读取主题：${escapeHTML((r.topicIds||[]).join('、')||'无')} · 读取轮次：${escapeHTML((r.roundIds||[]).join('、')||'无')}</p>`).join('')}</details>`;
}
function directoryDetails(d){return d?`<p>旧主题介绍补齐：${Number(d.completed)||0}/${Number(d.total)||0} · ${Number(d.requests)||0} 次请求（依据已保存摘要生成）</p>`:'';}
function fragmentDetails(f){return f?`<p>分片阅读：已保存 ${Number(f.steps)||0} 片 · 已读完 ${Number(f.completed)||0}/${Number(f.documents)||0} 组材料。尚未合并完成的轮次不计入上方轮次进度。</p>`:'';}
function diagnosticDetails(d){
  if(!d)return '';
  const ends={stop:'正常结束',length:'输出达到上限',content_filter:'内容过滤',tool_calls:'工具调用',function_call:'函数调用',missing:'未提供',other:'未识别'};
  const fields=[['失败阶段',d.stage],['错误编号',d.code],['具体原因',d.reason],['处理环节',d.phase],['主题序号',d.topicNumber],['关系序号',d.relationNumber],['所在轮次',d.roundLabel],['字段',d.field],['应当返回',d.expected],['实际情况',d.actual],['建议操作',d.nextStep],['结束原因',d.finishReason?ends[d.finishReason]||'未识别':undefined],['本次输出上限',d.outputLimit],['估算输入',d.estimatedInput],['任务输入预算',d.inputBudget],['模型上下文',d.contextWindow],['保守输入计量',d.upperInput],['输入用量',d.prompt_tokens],['输出用量',d.completion_tokens],['总用量',d.total_tokens],['收到正文字符数',d.bodyCharacters],['是否检测到推理字段',typeof d.reasoningPresent==='boolean'?(d.reasoningPresent?'是':'否'):undefined],['收到流结束标记',d.stream?(d.streamDone?'是':'否'):undefined]];
  return `<details class="history-review"><summary>错误诊断</summary><p>${fields.filter(([,v])=>v!==undefined).map(([k,v])=>escapeHTML(k)+'：'+escapeHTML(v)).join('<br>')}</p><p>用量仅在接口提供时显示；不保存回复正文、推理内容或 API Key。</p></details>`;
}
let busy=false;
async function refresh(initial=false){
  const s=await send({type:'queue-list'}), l=s.library;
  report('folderState',l.connected?`已连接：${l.name} · ${l.granted?'已授权':'需要重新授权'}${l.lastSavedAt?' · 最近保存 '+new Date(l.lastSavedAt).toLocaleString('zh-CN'):''}${l.error?'\n'+l.error:''}`:'尚未选择文件夹；当前记录暂存于浏览器。',Boolean(l.error||l.connected&&!l.granted));
  report('queueNotice',s.notice||'',Boolean(s.notice));
  if(initial){$('pathLabel').value=l.pathLabel||l.suggestedPath;$('organizeMode').value=s.settings.mode;$('idleDelay').value=s.settings.delay;}
  $('tasks').innerHTML=s.tasks.length?s.tasks.map(t=>`<div class="task-row"><b>${escapeHTML(t.title)} · ${labels[t.state]||escapeHTML(t.state)}</b><p>${escapeHTML(t.branchId)} · 已完成 ${t.processed} / ${t.total} 轮 · 剩余 ${Math.max(0,t.total-t.processed)} 轮</p><p>${new Date(t.createdAt).toLocaleString('zh-CN')}</p>${t.error?`<p class="error">${escapeHTML(t.error)}</p>${diagnosticDetails(t.errorDiagnostics)}`:''}${fragmentDetails(t.fragmentProgress)}${directoryDetails(t.directoryReview)}${historyDetails(t.historyReview)}<div class="task-actions">${['error','interrupted','cancelled'].includes(t.state)?`<button data-task="${escapeHTML(t.id)}" data-action="resume">续做</button>`:''}${['queued','running','error','interrupted'].includes(t.state)?`<button data-task="${escapeHTML(t.id)}" data-action="cancel">取消</button>`:''}</div></div>`).join(''):'<p>暂无任务。请在侧栏点击“抽取关系图”开始。</p>';
  const {conversations:records}=await send({type:'view-list'});
  const selection=$('versionConversation').value;
  const options=records.map(r=>`<option value="${escapeHTML(r.key)}">${escapeHTML(r.title)}</option>`).join('');
  if($('versionConversation').innerHTML!==options){$('versionConversation').innerHTML=options;if(records.some(r=>r.key===selection))$('versionConversation').value=selection;}
  const selected=records.find(r=>r.key===$('versionConversation').value)||records[0];
  const record=selected?(await send({type:'view-get',key:selected.key,branchId:'current'})).record:null;
  const analysis=record&&AtlasAI.analysis(record,'current');
  report('recordDetails',record?[
    `${record.platform} · ${record.title}`,
    `最近采集：${record.updatedAt?new Date(record.updatedAt).toLocaleString('zh-CN'):'时间未知'}`,
    `来源：${record.source?.type||'网页文本'} · 完整性：${record.source?.completeness||'未知'}`,
    record.source?.note||'',
    record.source?.omittedNonText?`${record.source.omittedNonText} 段含未提取的非文本内容`:'',
    record.source?.unreadableContent?`${record.source.unreadableContent} 个节点暂无可解析正文`:'',
    analysis?.model?`归纳模型：${analysis.model}`:'',
    analysis?.result?.topics?.length?'主题目录（编号 · 名称：一句话介绍）':'',
    ...(analysis?.result?.topics||[]).map(t=>`${t.id} · ${t.name}：${AtlasAI.validTopicBrief(t.brief)?t.brief:'待补齐（旧记录没有独立介绍）'}`),
    ...(analysis?.result?.warnings||[])
  ].filter(Boolean).join('\n'):'暂无本地记录。');
}
$('versionConversation').onchange=()=>refresh().catch(e=>report('versionResult',e.message,true));
$('selectFolder').onclick=async()=>{
  if(busy)return;busy=true;
  try{
    // Picker is the first async operation: preserve the user's activation.
    const h=await window.showDirectoryPicker({id:'topic-atlas-library',mode:'readwrite',startIn:'documents'});
    report('folderResult','正在复制并校验记录，请保持本页打开…');
    await AtlasLibrary.handle('pending',h);
    const result=await send({type:'library-connect',migrate:$('migrate').checked,pathLabel:$('pathLabel').value});
    activeHandle=h;
    $('reauthorize').disabled=false;
    report('folderResult',`已连接 ${h.name}，完成 ${result.count} 项复制校验。当前授权已生效，但浏览器未提供是否永久的查询接口；请阅读下方关闭设置页后的授权说明。`);await refresh(true);
  }catch(e){if(e.name!=='AbortError')report('folderResult',e.message,true);}finally{busy=false;}
};
let activeHandle;
$('reauthorize').onclick=async()=>{
  if(busy)return;busy=true;
  try{
    if(!activeHandle)throw new Error('尚未选择文件夹。');
    if(await activeHandle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('未获得读写授权。');
    const result=await send({type:'library-reconnect'});
    report('folderResult',`授权已恢复，已同步并校验 ${result.count} 项记录。若弹窗提供“每次访问都允许”，请选择该项；仅本次授权仍可能在关闭页面后结束。`);await refresh();
  }catch(e){report('folderResult',e.message,true);}finally{busy=false;}
};
$('autoForm').onsubmit=async e=>{
  e.preventDefault();try{await send({type:'queue-settings',mode:$('organizeMode').value,delay:Number($('idleDelay').value)});report('autoResult','设置已保存。');}catch(err){report('autoResult',err.message,true);}
};
$('tasks').onclick=async e=>{const b=e.target.closest('[data-task]');if(!b)return;try{await send({type:'queue-action',id:b.dataset.task,action:b.dataset.action});await refresh();}catch(err){report('autoResult',err.message,true);}};
$('loadVersions').onclick=async()=>{
  try{const r=await send({type:'library-versions',key:$('versionConversation').value});$('versions').innerHTML=r.versions.length?r.versions.map(v=>`<div class="version-row"><b>${new Date(v.createdAt).toLocaleString('zh-CN')}</b><p>${escapeHTML(v.reason)}</p><button data-version="${escapeHTML(v.id)}">恢复此版本</button></div>`).join(''):'<p>暂无文件夹备份版本。</p>';}catch(e){report('versionResult',e.message,true);}
};
$('versions').onclick=async e=>{const b=e.target.closest('[data-version]');if(!b||!confirm('恢复此本地版本？当前记录会先备份，并暂停这条对话的自动整理。'))return;try{await send({type:'library-restore',key:$('versionConversation').value,id:b.dataset.version});report('versionResult','已恢复本地版本。');}catch(err){report('versionResult',err.message,true);}};
AtlasLibrary.handle().then(h=>{activeHandle=h;$('reauthorize').disabled=!h;}).catch(()=>{});
refresh(true).catch(e=>report('folderState',e.message,true));
setInterval(()=>{if(!busy)refresh().catch(e=>report('folderState',e.message,true));},3000);
