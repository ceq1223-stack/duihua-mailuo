'use strict';
(() => {
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const request=async m=>{const r=await chrome.runtime.sendMessage(m);if(r?.error)throw new Error(r.error);return r;};
let aiConfig,capabilityOptions={};
function dialogStatus(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
async function refreshConfig() { aiConfig=await request({type:'ai-get-config'}); }
function fillProfile(id) {
  const p = aiConfig.profiles[id];
  $('providerInput').value = id; $('baseUrlInput').value = p.baseUrl;
  $('baseUrlInput').readOnly = id !== 'custom';
  $('modelInput').value = p.model; $('maxTokensInput').value = p.maxTokens;
  $('requestTimeoutInput').value=p.requestTimeoutSeconds??600;
  $('inputBudgetInput').value = p.inputBudget ?? 12000; $('batchRoundsInput').value = p.batchRounds ?? 6; $('reuseResultsInput').checked = p.reuseResults !== false;
  $('jsonModeInput').checked = p.jsonMode; $('rememberKeyInput').checked = p.rememberKey;
  $('apiKeyInput').value = ''; $('modelNames').innerHTML = '';
  fillCapability(p.capability);
  $('keyHint').textContent = p.hasKey ? '已保存 Key；留空继续使用。切换服务不会共用 Key。' : '尚未保存 Key。请从服务商 API 控制台获取。';
  dialogStatus('apiDialogStatus', '');
}
$('providerInput').onchange = () => {capabilityOptions={};fillProfile($('providerInput').value);};
function fillCapability(c){
  $('capabilityStatus').textContent=c?`已获得当前模型的能力信息：上下文 ${c.contextWindow}，最大输出 ${c.maxOutput}。无需手动填写。`:'无需填写上下文容量。接口未提供能力信息时，按当前输入预算处理；遇到实际超限会尝试缩小或分段。';
}
function selectedCapability(provider,baseUrl,model){const c=capabilityOptions[model]||aiConfig?.profiles[provider]?.capability;return c?.baseUrl===baseUrl&&c?.model===model?c:null;}
$('modelInput').oninput=()=>{try{const p=$('providerInput').value,url=AtlasAI.endpoint(p==='custom'?$('baseUrlInput').value:AtlasAI.presets[p].baseUrl).baseUrl;fillCapability(selectedCapability(p,url,$('modelInput').value.trim()));}catch{fillCapability(null);}};
$('baseUrlInput').oninput=()=>{capabilityOptions={};fillCapability(null);};
function formConfig() {
  const provider=$('providerInput').value,baseUrl=AtlasAI.endpoint(provider==='custom'?$('baseUrlInput').value:AtlasAI.presets[provider].baseUrl).baseUrl,model=$('modelInput').value.trim();
  const c=selectedCapability(provider,baseUrl,model);
  const config=AtlasAI.config({ provider,baseUrl,model,capability:c,maxTokens: $('maxTokensInput').value, inputBudget:$('inputBudgetInput').value, batchRounds:$('batchRoundsInput').value, requestTimeoutSeconds:$('requestTimeoutInput').value,reuseResults:$('reuseResultsInput').checked, jsonMode: $('jsonModeInput').checked, rememberKey: $('rememberKeyInput').checked });
  return config;
}
async function saveAPI(clearKey = false) {
  const config = formConfig();
  if (!clearKey && !await chrome.permissions.request({ origins: [AtlasAI.endpoint(config.baseUrl).permission] })) throw new Error('未授权 API 站点，设置尚未保存。');
  await request({ type: 'ai-save-config', config, apiKey: $('apiKeyInput').value, clearKey });
  await refreshConfig(); $('apiKeyInput').value = '';
  $('keyHint').textContent = aiConfig.profiles[config.provider].hasKey ? 'Key 已保存；留空继续使用。' : '尚未保存 Key。';
  fillCapability(config.capability);
}
$('apiForm').onsubmit = async event => {
  event.preventDefault();
  try { await saveAPI(); dialogStatus('apiDialogStatus','API 设置已保存。'); }
  catch (e) { dialogStatus('apiDialogStatus', e.message, true); }
};
$('clearApiKey').onclick = async () => {
  try { await saveAPI(true); dialogStatus('apiDialogStatus', '此服务的 Key 已清除。'); }
  catch (e) { dialogStatus('apiDialogStatus', e.message, true); }
};
$('getModels').onclick = async () => {
  $('getModels').disabled = true;
  try {
    await saveAPI(); dialogStatus('apiDialogStatus', '正在读取模型列表，不发送对话正文……');
    const { models,capabilities } = await request({ type: 'ai-models' });capabilityOptions=capabilities||{};
    if(capabilityOptions[$('modelInput').value])fillCapability(capabilityOptions[$('modelInput').value]);
    $('modelNames').innerHTML = models.map(id => `<option value="${esc(id)}"></option>`).join('');
    dialogStatus('apiDialogStatus', `已读取 ${models.length} 个模型。请选择或填写模型 ID，再点击“测试连接”验证模型能否回复。`);
    $('modelInput').focus();
  } catch (e) { dialogStatus('apiDialogStatus', e.message, true); }
  finally { $('getModels').disabled = false; }
};
$('testConnection').onclick = async () => {
  const controls = [...$('apiForm').querySelectorAll('input,select,button')].filter(n => n.id !== 'closeApi');
  try {
    const config = formConfig(), apiKey = $('apiKeyInput').value;
    if (!config.model) throw new Error('请先填写或获取模型 ID，再测试连接。');
    controls.forEach(n => { n.disabled = true; }); $('testConnection').textContent = '测试中…';
    if (!await chrome.permissions.request({ origins: [AtlasAI.endpoint(config.baseUrl).permission] })) throw new Error('未授权 API 站点，尚未发送测试请求。');
    dialogStatus('apiDialogStatus', `正在向 ${config.model} 发送简短测试请求，不包含对话内容……`);
    const result = await request({ type: 'ai-test', config, apiKey });
    dialogStatus('apiDialogStatus', `连接成功 · ${result.model} 已正常回复${result.jsonMode ? '，JSON 格式有效' : ''} · 耗时 ${(result.elapsedMs / 1000).toFixed(1)} 秒。测试使用当前填写的配置；点击“保存设置”后生效。`);
  } catch (e) { dialogStatus('apiDialogStatus', e.message, true); }
  finally { controls.forEach(n => { n.disabled = false; }); $('testConnection').textContent = '测试连接'; }
};
$('resetPrompt').onclick = () => { $('promptInput').value = AtlasPrompt.default; dialogStatus('promptStatus', '已恢复默认内容，点击保存后生效。'); };
$('promptForm').onsubmit = async event => {
  event.preventDefault();
  try { await request({ type: 'ai-save-prompt', prompt: $('promptInput').value }); dialogStatus('promptStatus','提示词已保存，下次抽取时使用。'); }
  catch (e) { dialogStatus('promptStatus', e.message, true); }
};

refreshConfig().then(()=>{fillProfile(aiConfig.provider);$('promptInput').value=aiConfig.prompt;}).catch(e=>dialogStatus('apiDialogStatus',e.message,true));
})();
