// This function is serialized into ChatGPT's MAIN world. Keep it self-contained.
// Login credentials remain in page memory; only an allowlisted conversation
// payload is returned to the extension. No session/token is stored or logged.
async function readChatGPTPage(expectedId, markersOnly = false) {
  const currentId = () => location.pathname.match(/\/c\/([^/]+)/)?.[1];
  if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname) || currentId() !== expectedId || !/^[a-zA-Z0-9_-]{1,128}$/.test(expectedId)) return { error: 'PAGE_CHANGED' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
  try {
    let token;
    try {
      const session = await fetch('/api/auth/session', { credentials: 'include', signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (session.ok) {
        const auth = await session.json();
        if (typeof auth.accessToken === 'string') token = auth.accessToken;
      }
    } catch (error) { if (controller.signal.aborted) throw error; }
    const response = await fetch('/backend-api/conversation/' + encodeURIComponent(expectedId), {
      method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    });
    token = undefined;
    if (!response.ok) return { error: 'HTTP_' + response.status };
    if (!response.headers.get('content-type')?.includes('json')) return { error: 'NOT_JSON' };
    const data = await response.json();
    if (currentId() !== expectedId) return { error: 'PAGE_CHANGED' };
    if (!data || typeof data.mapping !== 'object' || Array.isArray(data.mapping) || !data.mapping) return { error: 'SCHEMA_CHANGED' };
    if (Object.keys(data.mapping).length > 30000) return { error: 'TOO_LARGE' };
    if (markersOnly === true) {
      // Diagnostic values are categorical: never return arbitrary provider strings,
      // message text, identifiers, arguments, URLs, metadata values or credentials.
      const known=(value,allowed)=>value==null?'missing':allowed.includes(value)?value:'other';
      const types=['text','multimodal_text','code','execution_output','thoughts','reasoning','analysis','tool_call','tool_result','image_asset_pointer','audio','video'];
      const targets=['all','python','browser','web','web.run','container.exec','container.exec_command','functions.exec_command','functions.run','functions.execute','functions.apply_patch','functions.write_stdin','functions.exec','multi_tool_use.parallel','computer'];
      const keys=(obj,allowed)=>allowed.filter(k=>obj&&typeof obj==='object'&&Object.hasOwn(obj,k));
      const path=[],seen=new Set();let current=data.current_node;
      while(current&&data.mapping[current]&&!seen.has(current)){
        seen.add(current);path.push(current);current=data.mapping[current].parent;
      }
      path.reverse();const order=new Map(path.map((id,i)=>[id,i+1]));
      const rows=[];let number=0;
      for(const [id,node] of Object.entries(data.mapping)){
        number++;const m=node?.message;if(!m||typeof m!=='object')continue;
        const c=m.content,metadata=m.metadata;
        const recipient=typeof m.recipient==='string'?m.recipient:null;
        const role=m.author?.role;
        const row={nodeNumber:number,onCurrentPath:order.has(id),pathOrder:order.get(id)||null,
          role:known(role,['user','assistant','system','developer','tool','function']),
          channel:known(m.channel,['analysis','commentary','final','summary','justify','confidence','complete','notification','delegate_summary','juicepred']),
          recipient:known(m.recipient,targets),recipientPresent:Object.hasOwn(m,'recipient'),
          recipientLooksLikeTool:recipient!==null&&recipient!=='all',
          authorName:known(m.author?.name,targets),
          status:known(m.status,['finished_successfully','in_progress','finished_partial','finished_error']),
          contentType:known(c?.content_type,types),
          language:known(c?.language,['bash','sh','shell','python','javascript','typescript','json','html','css','sql','powershell']),
          contentFields:keys(c,['content_type','parts','text','language','result','output','thoughts','reasoning','tool_calls','function_call']),
          partTypes:[],partCount:Array.isArray(c?.parts)?c.parts.length:0,
          toolCallsCount:Array.isArray(m.tool_calls)?m.tool_calls.length:0,
          functionCallPresent:!!m.function_call,
          messageFields:keys(m,['recipient','channel','tool_calls','function_call','tool_call_id','end_turn','weight']),
          metadataFields:keys(metadata,['is_visually_hidden_from_conversation','is_user_system_message','message_type','is_complete','is_internal','is_tool_call','tool_calls','invoked_plugin','citations','reasoning_status','status','finish_details']),
          hidden:metadata?.is_visually_hidden_from_conversation===true,
          internal:metadata?.is_internal===true,toolCallMarked:metadata?.is_tool_call===true,
          userSystemMessage:metadata?.is_user_system_message===true,
          messageType:known(metadata?.message_type,['next','continue','variant','tool_call','tool_result','system','user','assistant']),
          endTurn:typeof m.end_turn==='boolean'?m.end_turn:null};
        if(Array.isArray(c?.parts))row.partTypes=[...new Set(c.parts.map(p=>typeof p==='string'?'string':p&&typeof p==='object'?known(p.content_type||p.type,types):'other'))];
        rows.push(row);
      }
      const counts={};for(const r of rows){const category=r.role+'/'+r.channel+'/'+r.contentType;counts[category]=(counts[category]||0)+1;}
      return {diagnostics:{schemaVersion:'message-markers-1',platform:'ChatGPT',nodeCount:Object.keys(data.mapping).length,messageCount:rows.length,
        currentPathMessages:rows.filter(r=>r.onCurrentPath).length,pathIncomplete:!!current,
        privacy:'仅结构类别、字段存在性和计数；不包含正文、消息ID、工具参数、任意元数据值或凭据。other表示未列入诊断白名单，不能据此判定应删除。',
        counts,messages:rows}};
    }
    const mapping = {};
    for (const [id, node] of Object.entries(data.mapping)) {
      if (!node || typeof node !== 'object') continue;
      const message = node.message;
      mapping[id] = { id, parent: typeof node.parent === 'string' ? node.parent : null,
        children: Array.isArray(node.children) ? node.children.filter(v => typeof v === 'string') : [],
        message: message ? { id: message.id, author: { role: message.author?.role }, content: message.content, channel: message.channel,
          recipient:typeof message.recipient==='string'?message.recipient:null,end_turn:typeof message.end_turn==='boolean'?message.end_turn:null,
          toolCall:!!(Array.isArray(message.tool_calls)&&message.tool_calls.length||message.function_call),status:typeof message.status === 'string' ? message.status : null,
          create_time: message.create_time, metadata: { is_visually_hidden_from_conversation: Boolean(message.metadata?.is_visually_hidden_from_conversation), is_user_system_message: Boolean(message.metadata?.is_user_system_message),is_internal:message.metadata?.is_internal===true,is_tool_call:message.metadata?.is_tool_call===true } } : null };
    }
    return { data: { mapping, current_node: data.current_node, title: typeof data.title === 'string' ? data.title : '' } };
  } catch (error) { return { error: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' }; }
  finally { clearTimeout(timer); }
}
