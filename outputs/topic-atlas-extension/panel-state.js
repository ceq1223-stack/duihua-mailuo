/* Summaries only: detailed source, provider, budget and task errors live in settings. */
const AtlasPanelState = (() => {
  function describe(record,branchId,tasks=[]) {
    const relevant=tasks.filter(t=>t.key===record?.key&&t.branchId===branchId);
    const active=relevant.find(t=>['queued','running'].includes(t.state));
    if(active)return {state:active.state,label:active.state==='running'?'进行中':'等待中',time:active.startedAt||active.createdAt,timeLabel:active.startedAt?'开始于':'加入于'};
    const latest=relevant[0];
    if(latest&&['error','interrupted','cancelled'].includes(latest.state))return {state:latest.state==='error'?'error':'paused',label:latest.state==='error'?'失败':'已暂停',time:latest.startedAt||latest.createdAt,timeLabel:latest.startedAt?'开始于':'加入于'};
    const analysis=record&&(AtlasAI.displayAnalysis?AtlasAI.displayAnalysis(record,branchId):AtlasAI.analysis(record,branchId));
    if(analysis&&!analysis.stale)return {state:'done',label:'已完成',time:analysis.generatedAt,timeLabel:'完成于'};
    if(analysis?.stale)return {state:'stale',label:'待更新',time:analysis.generatedAt,timeLabel:'上次完成于'};
    return {state:'idle',label:'未开始',time:null,timeLabel:''};
  }
  return {describe};
})();
