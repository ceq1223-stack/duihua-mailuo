(() => {
  'use strict';
  const A = typeof Atlas !== 'undefined' ? Atlas : require('./core.js');
  const presets = {
    openai: { name: 'OpenAI（ChatGPT）', baseUrl: 'https://api.openai.com/v1' },
    kimi: { name: 'Kimi（Moonshot）', baseUrl: 'https://api.moonshot.cn/v1' },
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
    custom: { name: '自定义兼容接口', baseUrl: '' }
  };
  function endpoint(value) {
    let u;
    try { u = new URL(String(value || '').trim()); } catch { throw new Error('请输入有效的 API 地址。'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('API 地址须为 HTTPS，且不能包含账号、密码、查询参数或片段。');
    let path = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const baseUrl = u.origin + path;
    return { baseUrl, origin: u.origin, permission: u.origin + '/*', chatUrl: baseUrl + '/chat/completions', modelsUrl: baseUrl + '/models' };
  }
  function config(raw) {
    if (!Object.hasOwn(presets, raw?.provider)) throw new Error('请选择支持的 API 服务。');
    const ep = endpoint(raw.provider === 'custom' ? raw.baseUrl : presets[raw.provider].baseUrl);
    const model = String(raw.model || '').trim();
    if (model.length > 200 || /[\r\n]/.test(model)) throw new Error('模型 ID 格式不正确。');
    const maxTokens = Number(raw.maxTokens ?? 12000);
    if (!Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > 1000000) throw new Error('最大输出长度须为 512—1000000 的整数；实际值还受模型能力约束。');
    const inputBudget = Number(raw.inputBudget ?? 12000), batchRounds = Number(raw.batchRounds ?? 6);
    if (!Number.isInteger(inputBudget) || inputBudget < 4000 || inputBudget > 4000000) throw new Error('单次输入预算须为 4000—4000000 的整数；实际值还受模型能力约束。');
    if (!Number.isInteger(batchRounds) || batchRounds < 1 || batchRounds > 12) throw new Error('每段轮数须为 1—12 的整数。');
    const c=raw.capability;
    const capability=c&&c.baseUrl===ep.baseUrl&&c.model===model&&c.confirmed===true&&['manual','provider'].includes(c.method)
      &&Number.isInteger(c.contextWindow)&&c.contextWindow>=1024&&c.contextWindow<=10000000
      &&Number.isInteger(c.maxOutput)&&c.maxOutput>=512&&c.maxOutput<=c.contextWindow
      &&(c.maxInput==null||Number.isInteger(c.maxInput)&&c.maxInput>0)
      &&typeof c.source==='string'&&c.source.trim()&&c.source.length<=500
      ?{baseUrl:ep.baseUrl,model,contextWindow:c.contextWindow,maxOutput:c.maxOutput,maxInput:Number.isInteger(c.maxInput)&&c.maxInput>0?Math.min(c.maxInput,c.contextWindow):null,source:c.source,method:c.method,confirmed:true,checkedAt:typeof c.checkedAt==='string'?c.checkedAt:null}:null;
    return { provider: raw.provider, baseUrl: ep.baseUrl, model, maxTokens, inputBudget, batchRounds,capability, reuseResults: raw.reuseResults !== false, jsonMode: raw.jsonMode !== false, rememberKey: raw.rememberKey === true };
  }
  function effectiveProfile(raw) {
    const p=config(raw),c=p.capability;
    if(!c)throw problem('模型能力核对','MODEL_CAPABILITY_UNKNOWN','尚未核对当前服务与模型的上下文及输出上限，未发送整理请求；请在设置中获取能力信息或填写有依据的能力值并确认',{nextStep:'能力必须对应当前 API 地址和模型；小请求连接成功不能证明上下文能力。'});
    const maxTokens=Math.min(p.maxTokens,c.maxOutput),safety=Math.max(512,Math.ceil(c.contextWindow*.08));
    const capacity=Math.min(c.maxInput||c.contextWindow,c.contextWindow-maxTokens-safety);
    if(capacity<512)throw problem('模型能力核对','MODEL_CAPACITY_FIXED','输出预留与安全余量已占满模型上下文；请调整输出预留或选择能力更大的模型');
    return {...p,maxTokens,inputBudget:Math.min(p.inputBudget,capacity),safety,capacity};
  }
  function requestSize(body) {
    const text=JSON.stringify({messages:body.messages,response_format:body.response_format});let upper=256,estimate=200;
    for(const ch of text){const n=ch.codePointAt(0);upper+=n<128?1:n<2048?2:n<65536?3:4;estimate+=n<128?.4:2;}
    return {estimatedInput:Math.ceil(estimate),upperInput:upper};
  }
  function checkRequest(profile,body,stage='请求规划') {
    const c=profile.capability;
    if(!c)throw problem(stage,'MODEL_CAPABILITY_UNKNOWN','模型能力尚未核对，未发送请求');
    const size=requestSize(body),output=body.max_completion_tokens??body.max_tokens??profile.maxTokens;
    if(output>c.maxOutput||size.estimatedInput>profile.inputBudget||size.upperInput>Math.min(c.maxInput||c.contextWindow,c.contextWindow-output-(profile.safety||Math.max(512,Math.ceil(c.contextWindow*.08)))))
      throw problem(stage,'REQUEST_BUDGET','完整请求超过已核对的能力或成本预算，需要继续分片',{...size,inputBudget:profile.inputBudget,outputLimit:output,contextWindow:c.contextWindow});
    return size;
  }
  function pathRecord(record, branchId) {
    if (!record) throw new Error('请先读取一条对话。');
    if (!record.allMessages) {
      if (branchId !== 'current') throw new Error('所选分支不存在。');
      return {...record,messages:A.answerMessages(record.messages)};
    }
    const branch = record.branches?.find(b => b.id === branchId);
    if (!branch) throw new Error('所选分支不存在，请重新选择。');
    const byId = new Map(record.allMessages.map(m => [m.id, m]));
    if (branch.messageIds.some(id => !byId.has(id))) throw new Error('分支消息不完整，请重新读取。');
    return { ...record, messages:A.answerMessages(branch.messageIds.map(id => byId.get(id))) };
  }
  function signature(record, branchId) {
    const path = pathRecord(record, branchId);
    return A.hash(JSON.stringify({ messages: path.messages.map(m => [m.id, m.role, m.text, !!m.nonText, m.channel || null]),
      annotations: A.turns(path.messages).map(t => [t.id, path.annotations?.[t.id] || null]) }));
  }
  function quoteCandidates(text) {
    const source=String(text || '');
    const lines=source.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>=8);
    return [...new Set([source.trim().slice(0,60),...lines.slice(0,3).map(s=>s.slice(0,60))])].filter(Boolean).slice(0,3);
  }
  function sourceQuote(source, quote) {
    if (source.includes(quote)) return quote;
    function canonical(text) {
      const chars=[]; let offset=0;
      for(const char of text){
        const start=offset;offset+=char.length;
        if(/[\u200b\ufeff]/u.test(char))continue;
        const c=/\s/u.test(char)?' ':({ '“':'"','”':'"','‘':"'",'’':"'" }[char] || char);
        if(c===' ' && chars.at(-1)?.c===' '){chars.at(-1).end=offset;continue}
        chars.push({c,start,end:offset});
      }
      const kept=chars.filter((t,i)=>!(t.c===' ' && /\p{Script=Han}/u.test(chars[i-1]?.c || '') && /\p{Script=Han}/u.test(chars[i+1]?.c || '')));
      return {text:kept.map(t=>t.c).join(''),map:kept.flatMap(t=>Array.from({length:t.c.length},()=>({start:t.start,end:t.end})))};
    }
    const body=canonical(source), needle=canonical(quote).text.trim();
    if(!needle || (needle.replace(/\s/g,'').length<8 && body.text.trim()!==needle))return null;
    const index=body.text.indexOf(needle);
    if(index<0)return null;
    const actual=source.slice(body.map[index].start,body.map[index+needle.length-1].end);
    return actual.length<=500?actual:null;
  }
  function prepare(record, branchId = 'current') {
    if(record?.platform==='ChatGPT'&&record.source?.filterVersion!==A.answerFilterVersion)throw problem('整理前来源检查','SOURCE_REFRESH_REQUIRED','旧记录未保留足够的消息类型标记，无法可靠排除工具调用；本次未发送整理请求。请刷新该 ChatGPT 对话，等待自动读取后点击“抽取关系图”新建任务，不要续做旧来源快照',{nextStep:'重新加载扩展并刷新该 ChatGPT 对话，等待自动采集后点击“抽取关系图”新建任务；不要续做旧来源快照。'});
    const path = pathRecord(record, branchId), turns = A.turns(path.messages);
    if (!turns.length) throw new Error('所选分支没有可整理的对话。');
    const rounds = turns.map((t,i) => ({ roundId: t.id, ref:'R'+(i+1), messages: [t.user, ...t.assistants, ...(t.unknowns || [])].filter(Boolean)
      .flatMap(m => m.segments || [m]).map((m,j) => {
        const source = path.messages.find(item => item.id === m.id) || m;
        const text=source.nonText && source.text.startsWith('［非文本消息') ? '' : m.text;
        return { messageId: m.id, role: m.role, text, nonText: !!source.nonText, ref:'R'+(i+1)+'M'+(j+1), quoteCandidates:quoteCandidates(text) };
      }) }));
    const knownGaps = [];
    if (path.source?.completeness !== 'returned-tree') knownGaps.push('输入可能仅包含部分历史，不可声称完整会话。');
    if (rounds.some(r => r.messages.some(m => m.nonText))) knownGaps.push('部分消息含未提取的附件内容，不可猜测。');
    if (rounds.some(r => r.messages.some(m => m.role === 'unknown'))) knownGaps.push('部分消息角色未识别。');
    const previous = record.aiResults?.[branchId];
    const currentMessages = new Map(path.messages.map(m => [m.id, A.hash(JSON.stringify([m.role, m.text]))]));
    // A current-path alias may now point to another platform version. Never
    // send prior branch summaries unless every original message still matches.
    const compatible = previous?.sourceMessages?.length && previous.sourceMessages.every(([id, hash]) => currentMessages.get(id) === hash);
    const previousResult = compatible ? previous.result : null;
    const manualAnnotations = turns.filter(t => path.annotations?.[t.id]).map(t => ({ roundId: t.id, ...path.annotations[t.id] }));
    const input = { branchId, sourceCompleteness: path.source?.completeness || 'partial', knownGaps, rounds, previousResult, manualAnnotations };
    if (!rounds.some(r => r.messages.some(m => m.text.trim()))) throw new Error('所选分支没有可读正文，无法抽取关系图。');
    if (rounds.length > 10000 || JSON.stringify(rounds).length > 20000000) throw new Error('本机待处理数据过大（超过 1 万轮或 2000 万字符），请先缩小所选记录。未发送或截断正文。');
    return { input, fingerprint: signature(record, branchId) };
  }
  function validTopicBrief(value) {
    return typeof value==='string'&&value.trim().length>0&&Array.from(value.trim()).length<=60&&!/[\r\n\t]/.test(value);
  }
  function nextStep(code) {
    if(code==='INPUT_BUDGET'||code==='CONTEXT_LIMIT'||code==='OUTPUT_LIMIT')return '核对输入预算、输出上限及模型限制；修改设置并保存后，点击“抽取关系图”新建任务。';
    if(code==='LIBRARY_PERMISSION_REQUIRED'||code==='LIBRARY_WRITE_FAILED')return '先在资料库设置恢复授权或排除写盘问题并同步；不要仅为保存问题重复调用 AI。';
    if(code==='API_HTTP_401')return '检查并更新 API Key，再手动继续；修改模型或服务地址后应新建任务。';
    if(code==='API_HTTP_429')return '检查服务商限流或额度，等待恢复后手动继续；不会自动反复重试。';
    if(/^API_|^REPLY_/.test(code))return '根据本条原因检查接口、网络或模型回复格式；原因不明确时先检查服务商状态，再决定是否手动重试。';
    return '核对所标字段、轮次和原文；可手动续做。若修改模型、提示词或预算，请保存后点击“抽取关系图”新建任务。';
  }
  function problem(stage,code,reason,details={}) {
    const diagnostics={stage,code,reason,...details,nextStep:details.nextStep||nextStep(code)};
    const positions=[details.phase,details.topicNumber?'第 '+details.topicNumber+' 个主题':null,details.relationNumber?'第 '+details.relationNumber+' 条关系':null,details.roundLabel,details.field].filter(Boolean);
    const message=stage+'失败：'+String(reason).replace(/[。\s]+$/,'')+'。'+(positions.length?'位置：'+positions.join(' · ')+'。':'');
    return Object.assign(new Error(message),{code,diagnostics});
  }
  function describeError(error,stage='后台任务') {
    if(error?.diagnostics){
      error.diagnostics={...error.diagnostics,reason:error.diagnostics.reason||error.message,nextStep:error.diagnostics.nextStep||nextStep(error.diagnostics.code||error.code)};
      return error;
    }
    return problem(stage,error?.code||'TASK_ERROR',error?.message||'处理未完成，具体原因尚未确定');
  }
  function validate(raw, input, options = {}) {
    let where={phase:options.phase||'结构化结果'};
    const fail = (detail,code='VALIDATION_RESULT',extra={}) => { throw problem('AI 结果校验',code,detail,{...where,...extra}); };
    const string = (v, field, max = 2000) => {
      if(typeof v!=='string')fail(field+'格式不正确：缺失或不是字符串','VALIDATION_STRING_TYPE',{field,expected:'非空字符串',actual:v==null?'缺失':typeof v});
      if(!v.trim())fail(field+'格式不正确：空文字','VALIDATION_STRING_EMPTY',{field});
      if(v.length>max)fail(field+'格式不正确：长度超过上限','VALIDATION_STRING_LENGTH',{field,expected:'最多 '+max+' 字符',actual:v.length+' 字符'});
      return v;
    };
    const array = (v, field, max = 1000) => {
      if(!Array.isArray(v))fail(field+'格式不正确：缺失或不是数组','VALIDATION_ARRAY_TYPE',{field});
      if(v.length>max)fail(field+'格式不正确：数量超过上限','VALIDATION_ARRAY_LENGTH',{field,expected:'最多 '+max+' 项',actual:v.length+' 项'});
      return v;
    };
    if (!raw || raw.schemaVersion !== '1.0' || raw.branchId !== input.branchId) fail('版本或分支不匹配','VALIDATION_SCHEMA_BRANCH',{field:'schemaVersion / branchId'});
    const rounds = new Map(input.rounds.map(r => [r.roundId, r]));
    const aliases = new Map(input.rounds.filter(r=>r.ref).map(r=>[r.ref,r]));
    const resolveRound = id => rounds.get(id) || aliases.get(id);
    const location = r => r?.ref ? '第 '+r.ref.slice(1)+' 轮' : '当前分段';
    function evidence(items, field, expectedRound) {
      return array(items, field, 20).map((e,i) => {
        const saved=where;where={...where,field:field+'['+i+']',roundLabel:location(expectedRound)};
        const r = resolveRound(e?.roundId), prefix=location(expectedRound || r)+'的'+field;
        if(!r)fail(prefix+'引用了当前分段之外或不存在的轮次','EVIDENCE_ROUND');
        const msg=r.messages.find(m=>m.messageId===e.messageId) || r.messages.find(m=>m.ref && m.ref===e.messageId);
        if(!msg)fail(prefix+'引用了不存在的消息，请使用 messageId 或消息 ref','EVIDENCE_MESSAGE');
        if(msg.role!==e.role)fail(prefix+'的用户／AI 角色与原消息不一致','EVIDENCE_ROLE');
        const quote = string(e?.quote, '原文摘录', 500);
        const actual=sourceQuote(msg.text,quote);
        if(!actual)fail(prefix+'的摘录不是该消息的连续原文（不能改写、加省略号或引用旧主题摘要）','EVIDENCE_QUOTE');
        where=saved;return { roundId:r.roundId, messageId:msg.messageId, role:msg.role, quote:actual };
      });
    }
    const topics = array(raw.topics, '主题', input.rounds.length * 3).map((t,i) => {
      where={phase:options.phase||'结构化结果',topicNumber:i+1,field:'topics['+i+']'};
      if(options.requireBrief&&!validTopicBrief(t?.brief))fail('主题简短介绍 brief 缺失或格式不正确（须为1至60字的单行文字）','TOPIC_BRIEF_INVALID',{field:'brief'});
      return {id:string(t?.id,'主题 ID',100),name:string(t?.name,'主题名称',80),brief:validTopicBrief(t?.brief)?t.brief.trim():null,summary:string(t?.summary,'主题摘要'),roundIds:array(t?.roundIds,'主题轮次',input.rounds.length).map(id=>{const r=resolveRound(id);if(!r)fail('主题引用未知轮次','VALIDATION_TOPIC_ROUND',{field:'roundIds'});return r.roundId;})};
    });
    const outputIds = new Set(topics.map(t => t.id)), catalog = input.context?.topics || [];
    where={phase:options.phase||'结构化结果',field:'topics'};
    if (outputIds.size !== topics.length || new Set(topics.map(t => t.name.trim())).size !== topics.length) fail('主题 ID 或名称重复','VALIDATION_TOPIC_DUPLICATE');
    if (topics.some(t => catalog.some(old => old.id === t.id && old.name !== t.name))) fail('复用旧主题 ID 却改变了主题含义或名称','VALIDATION_TOPIC_RENAMED');
    const topicIds = new Set([...outputIds, ...catalog.map(t => t.id)]);
    where={phase:options.phase||'结构化结果',field:'timeline'};
    const timeline = array(raw.timeline, '时间线', input.rounds.length).map((t, i) => {
      const r = input.rounds[i];
      where={phase:options.phase||'结构化结果',field:'timeline['+i+']',roundLabel:location(r)};
      if (resolveRound(t?.roundId)?.roundId !== r.roundId) fail('轮次缺失、重复或顺序错误','VALIDATION_TIMELINE_ORDER',{field:'roundId'});
      if (t.primaryTopicId !== null && !outputIds.has(t.primaryTopicId)) fail('主要主题不存在或未返回本段摘要','VALIDATION_PRIMARY_TOPIC',{field:'primaryTopicId'});
      if (r.messages.some(m => m.text.trim()) && t.primaryTopicId === null) fail('可读轮次缺少主要主题','VALIDATION_PRIMARY_MISSING',{field:'primaryTopicId'});
      const secondary = array(t.secondaryTopicIds, '次要主题', topics.length);
      if (secondary.some(id => !outputIds.has(id) || id === t.primaryTopicId) || new Set(secondary).size !== secondary.length) fail('次要主题引用无效','VALIDATION_SECONDARY_TOPIC',{field:'secondaryTopicIds'});
      const summary = (role, value) => {
        const readable = r.messages.some(m => m.role === role && m.text.trim());
        if (!readable) { if (value !== null) fail('缺少角色正文却生成摘要','VALIDATION_ROLE_SUMMARY',{field:role+'Summary'}); return null; }
        return string(value, '角色摘要');
      };
      const ev = evidence(t.evidence, '轮次证据',r);
      if(ev.some(e=>e.roundId!==r.roundId))fail('轮次证据缺失或跨轮引用：证据不属于本轮','VALIDATION_TIMELINE_EVIDENCE_CROSS',{field:'evidence'});
      if(r.messages.some(m=>m.text.trim())&&!ev.length)fail('轮次证据缺失或跨轮引用：证据数组为空','VALIDATION_TIMELINE_EVIDENCE_EMPTY',{field:'evidence'});
      return { roundId:r.roundId, primaryTopicId: t.primaryTopicId, secondaryTopicIds: [...secondary], title: string(t.title, '轮次标题', 160), userSummary: summary('user', t.userSummary), assistantSummary: summary('assistant', t.assistantSummary), evidence: ev };
    });
    where={phase:options.phase||'结构化结果',field:'timeline'};
    if (timeline.length !== input.rounds.length) fail('时间线没有覆盖全部输入轮次','VALIDATION_TIMELINE_COVERAGE',{expected:input.rounds.length+' 轮',actual:timeline.length+' 轮'});
    const topicAt = t => [t.primaryTopicId, ...t.secondaryTopicIds].filter(Boolean);
    for (const [i,t] of topics.entries()) {
      where={phase:options.phase||'结构化结果',topicNumber:i+1,field:'roundIds'};
      const ids = timeline.filter(r => topicAt(r).includes(t.id)).map(r => r.roundId);
      if (!ids.length || JSON.stringify(ids) !== JSON.stringify(t.roundIds)) fail('主题轮次与时间线归属不一致','VALIDATION_TOPIC_MEMBERSHIP');
    }
    where={phase:options.phase||'结构化结果',field:'relations'};
    const relations = array(raw.relations, '关系', input.rounds.length * 4).map((e,i) => {
      const targetRound=resolveRound(e?.atRoundId), atRoundId=targetRound?.roundId;
      where={phase:options.phase||'结构化结果',relationNumber:i+1,field:'relations['+i+']',roundLabel:location(targetRound)};
      const index = timeline.findIndex(t => t.roundId === atRoundId);
      if(!topicIds.has(e?.from))fail('关系引用错误：起点主题不存在','VALIDATION_RELATION_FROM',{field:'from'});
      if(!topicIds.has(e?.to))fail('关系引用错误：终点主题不存在','VALIDATION_RELATION_TO',{field:'to'});
      if(e.from===e.to)fail('关系引用错误：起点与终点是同一主题','VALIDATION_RELATION_SELF',{field:'from / to'});
      if(!['flow','branch','return'].includes(e.type))fail('关系类型错误：只接受 flow、branch、return','VALIDATION_RELATION_TYPE',{field:'type'});
      if(index<0)fail('关系引用错误：发生轮次不在本段时间线内','VALIDATION_RELATION_ROUND',{field:'atRoundId'});
      if(typeof e.inferred!=='boolean')fail('关系字段错误：inferred 缺失或不是布尔值','VALIDATION_RELATION_INFERRED',{field:'inferred'});
      const seen = id => catalog.some(t => t.id === id) || timeline.slice(0, index).some(t => topicAt(t).includes(id));
      if(!topicAt(timeline[index]).includes(e.to))fail('关系方向或发生轮次不成立：终点主题不属于发生轮次','VALIDATION_RELATION_DIRECTION',{field:'to / atRoundId'});
      if(!seen(e.from))fail('关系方向或发生轮次不成立：起点主题此前未出现，也不在已读历史目录内','VALIDATION_RELATION_ORIGIN',{field:'from'});
      if (e.type === 'return' && !seen(e.to)) fail('回归目标此前未出现','VALIDATION_RETURN_UNSEEN');
      const ev = evidence(e.evidence, '关系证据',targetRound);
      if(!ev.length)fail('关系缺少目标轮次的证据：evidence 数组为空','VALIDATION_RELATION_EVIDENCE_EMPTY',{field:'evidence',expected:'至少一条目标轮次的原文证据',actual:'0 条证据'});
      if(!ev.some(item=>item.roundId===atRoundId))fail('关系缺少目标轮次的证据：已返回证据全部属于其他轮次','VALIDATION_RELATION_EVIDENCE_TARGET',{field:'evidence',expected:location(targetRound),actual:[...new Set(ev.map(item=>location(resolveRound(item.roundId))))].join('、')});
      return { from: e.from, to: e.to, type: e.type, atRoundId, label: string(e.label, '关系标签', 80), reason: string(e.reason, '关系依据'), inferred: e.inferred, evidence: ev };
    });
    const unique = new Set(relations.map(e => JSON.stringify([e.from, e.to, e.type, e.atRoundId])));
    where={phase:options.phase||'结构化结果',field:'relations'};
    if (unique.size !== relations.length) fail('重复关系','VALIDATION_RELATION_DUPLICATE');
    for (const a of input.manualAnnotations || []) {
      const t = timeline.find(t => t.roundId === a.roundId);
      where={phase:options.phase||'结构化结果',field:'manualAnnotations',roundLabel:location(resolveRound(a.roundId))};
      if (a.topic?.trim() && topics.find(n => n.id === t.primaryTopicId)?.name !== a.topic.trim()) fail('人工主题名称被覆盖','VALIDATION_MANUAL_TOPIC');
      if (a.relation) {
        const i = timeline.indexOf(t), previous = timeline.slice(0, i).reverse().find(t => t.primaryTopicId)?.primaryTopicId || input.context?.lastTopicId;
        if (previous && previous !== t.primaryTopicId && !relations.some(e => e.from === previous && e.to === t.primaryTopicId && e.atRoundId === a.roundId && e.type === a.relation)) fail('人工关系被覆盖','VALIDATION_MANUAL_RELATION');
      }
    }
    where={phase:options.phase||'结构化结果',field:'warnings'};
    const warnings = array(raw.warnings, '提示', input.context ? 50 : 1000).map(w => string(w, '提示内容', 1000));
    return { schemaVersion: '1.0', branchId: input.branchId, topics, timeline, relations, warnings: [...new Set([...input.knownGaps, ...warnings])] };
  }
  function analysis(record, branchId) {
    if(record?.viewOnly)return record.viewBranch===branchId?record.viewAnalysis:null;
    let entry = record?.aiResults?.[branchId];
    try {
      const fingerprint=signature(record,branchId), count=A.turns(pathRecord(record,branchId).messages).length;
      if(!entry || entry.fingerprint!==fingerprint) {
        const old=[...(record?.aiHistory||[])].reverse().find(h=>h.entry?.fingerprint===fingerprint&&h.entry.roundSignatures?.length===count&&h.entry.result?.timeline?.length===count);
        if(old)entry={...old.entry,result:{...old.entry.result,branchId}};
      }
      return entry ? {...entry,stale:entry.fingerprint!==fingerprint} : null;
    } catch { return entry ? { ...entry, stale: true } : null; }
  }
  function displayAnalysis(record, branchId) {
    if(record?.viewOnly)return record.viewBranch===branchId?record.viewAnalysis:null;
    const current = analysis(record,branchId);
    if (current && !current.stale) return current;
    if (!record) return null;
    try {
      const path=pathRecord(record,branchId);
      const byId=new Map(path.messages.map(m=>[m.id,m]));
      const messages=A.turns(path.messages).flatMap(t=>[t.user,...t.assistants,...(t.unknowns||[])].filter(Boolean))
        .flatMap(m=>m.segments||[m]).map(m=>{
          const source=byId.get(m.id)||m;
          const text=source.nonText&&source.text.startsWith('［非文本消息')?'':m.text;
          return [m.id,A.hash(JSON.stringify([m.role,text]))];
        });
      // Only completed publications qualify. History also contains partial checkpoints.
      // "current" is an alias: verify the entire old message prefix, not its branch label.
      const candidates=[...Object.values(record.aiResults||{}),...(record.aiHistory||[]).filter(h=>h.complete===true).map(h=>h.entry)];
      const removed=new Set(record.source?.filterVersion===A.answerFilterVersion?record.source.excludedMessageIds||[]:[]);
      const retained=candidates.filter(e=>{
        const kept=Array.isArray(e?.sourceMessages)?e.sourceMessages.filter(([id])=>!removed.has(id)):null;
        return e?.result&&Array.isArray(kept)&&kept.length>0&&kept.length<=messages.length
        &&kept.every(([id,hash],i)=>messages[i][0]===id&&messages[i][1]===hash)
        &&e.result.timeline?.length>0&&(!e.roundSignatures||e.result.timeline.length===e.roundSignatures.length);
      })
        .sort((a,b)=>(Date.parse(b.generatedAt)||0)-(Date.parse(a.generatedAt)||0))[0];
      return retained?{...retained,result:{...retained.result,branchId},stale:true}:null;
    } catch { return null; }
  }
  globalThis.AtlasAI = { presets, endpoint, config,effectiveProfile,requestSize,checkRequest, pathRecord, signature, prepare, validate, validTopicBrief, analysis, displayAnalysis, sourceQuote, problem, describeError };
  if (typeof module !== 'undefined') module.exports = globalThis.AtlasAI;
})();
