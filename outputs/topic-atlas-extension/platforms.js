/* DOM adapters use observed platform markers. Unknown completion stays unknown. */
(() => {
  'use strict';
  const text = node => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('button,[role="button"],script,style,nav,textarea,[hidden],[aria-hidden="true"],.sr-only,.cdk-visually-hidden,thinking-overlay,.ds-think-content').forEach(n => n.remove());
    copy.querySelectorAll('p,li,pre,h1,h2,h3,br').forEach(n => n.appendChild(node.ownerDocument.createTextNode('\n')));
    return Atlas.clean(copy.textContent);
  };
  function gemini(doc) {
    const result = [];
    for (const root of Atlas.pageRoots(doc)) for (const node of root.querySelectorAll('user-query,model-response')) {
      if (node.closest('[hidden],[aria-hidden="true"]')) continue;
      const role = node.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
      const parent = node.parentElement;
      const turnId = parent?.tagName === 'DIV' && /^[a-f0-9]{16}$/i.test(parent.id || '') ? parent.id : null;
      const content = role === 'assistant' ? node.querySelector('message-content') : node.querySelector('.query-text');
      const body = role === 'assistant' ? content?.querySelector('.markdown-main-panel') : content;
      // Never fall back to the entire response: it also contains thoughts and tools.
      if (!body) continue;
      const value = text(body);
      if (!value) continue;
      const nativeId = role === 'user' ? turnId : content.id || null;
      const busy = [...node.querySelectorAll('[aria-busy]')].map(n => n.getAttribute('aria-busy'));
      const finished = role === 'assistant' && busy.length > 0 && busy.every(v => v === 'false') && [...node.querySelectorAll('button[aria-label]')].some(n => ['复制', 'Copy'].includes(n.getAttribute('aria-label')));
      const status = role === 'user' || finished ? 'finished' : busy.includes('true') ? 'in_progress' : 'unknown';
      const id = role + ':' + (nativeId || 'unverified:' + Atlas.hash(value));
      result.push({id,nativeId,turnId,role,text:value,status,channel:role === 'assistant' ? 'final' : null,contentType:'text',endTurn:finished,_node:body});
    }
    return result;
  }
  function deepseek(doc) {
    const result=[];
    for(const root of Atlas.pageRoots(doc))for(const node of root.querySelectorAll('.ds-message')){
      if(node.closest('[hidden],[aria-hidden="true"]'))continue;
      const answer=node.querySelector('.ds-assistant-message-main-content');
      // These two hashed user classes were observed together on the real page.
      // If either changes, do not infer "user" from the absence of an answer.
      const user=node.matches?.('.d29f3d7d')?node.querySelector('.fbb737a4'):null;
      if(!!answer===!!user)continue;
      const body=answer||user,role=answer?'assistant':'user';
      const item=node.closest('[data-virtual-list-item-key]');
      const key=item?.getAttribute('data-virtual-list-item-key');
      if(!key||key.length>128)continue;
      const value=text(body);if(!value)continue;
      // A virtual-list key is a scoped DOM identity, not a verified API message ID.
      result.push({id:role+':deepseek-dom:'+key,nativeId:null,turnId:'deepseek-dom:'+key,role,text:value,status:role==='user'?'finished':'unknown',channel:answer?'final':null,contentType:'text',endTurn:false,_node:body});
    }
    return result;
  }
  function merge(previous, incoming, now, platform='Gemini') {
    let old = previous?.messages || [];
    if(previous?.source?.type!=='page-dom'){
      incoming=incoming.map(m=>{const exact=old.filter(o=>o.role===m.role&&o.text===m.text);return exact.length===1?{...m,id:exact[0].id}:m;});
      old=[];
    }
    if(incoming.some(m=>!m.turnId||platform!=='DeepSeek'&&!m.nativeId))old=[];
    // Edited/regenerated turns invalidate unseen descendants on the old path.
    let cut = old.length;
    for (const message of incoming) {
      if (!message.turnId) continue;
      const index = old.findIndex(m => m.turnId === message.turnId && m.role === message.role);
      if (index >= 0 && (old[index].nativeId !== message.nativeId || message.role === 'user' && old[index].text !== message.text || message.role==='assistant' && old[index].text!==message.text && !message.text.startsWith(old[index].text))) cut = Math.min(cut,index);
    }
    for(let i=0;i<incoming.length-1;i++){
      const user=incoming[i],reply=incoming[i+1];
      if(user.role!=='user'||reply.role!=='assistant')continue;
      const at=old.findIndex(m=>m.id===user.id&&m.role==='user');
      if(at>=0&&old[at+1]?.role==='assistant'&&old[at+1].id!==reply.id)cut=Math.min(cut,at+1);
    }
    if(old.length&&incoming.length&&!incoming.some(m=>old.some(o=>o.id===m.id||o.role===m.role&&o.turnId&&o.turnId===m.turnId)))old=[];
    const active = Atlas.merge({...previous,messages:old.slice(0,cut)}, incoming, now);
    return {messages:active,source:{type:'page-dom',completeness:'loaded-messages',filterVersion:Atlas.answerFilterVersion,total:active.length,loaded:incoming.length,attachments:'not-extracted',pathConfidence:platform==='DeepSeek'?'dom-visible-items':incoming.every(m=>m.turnId&&m.nativeId)?'native-visible-turns':'unverified-identity',completion:platform==='DeepSeek'?'unknown':'explicit-markers',note:'仅包含本地已采集及网页已加载的文字；不保证完整历史或附件正文。编辑或重生成后，未重新加载的旧后续内容不并入当前路径。'+(platform==='DeepSeek'?'DeepSeek 回复完成标记尚未确认，自动采集继续，但须手动抽取关系图。':'')}};
  }
  globalThis.AtlasPlatforms = {gemini,deepseek,merge};
})();
