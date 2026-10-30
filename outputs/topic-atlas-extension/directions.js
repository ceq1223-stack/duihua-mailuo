/* Evidence-backed suggestions are separate from discussed topics and human tasks. */
(() => {
  'use strict';
  const transitions={pending:['todo','ignored'],todo:['pending','done'],ignored:['pending'],done:['todo']};
  const identity=d=>JSON.stringify([d.parentTopicId,d.sourceRoundId,d.title,d.evidence]);
  function validate(raw,input,h){
    const {array,string,fail,evidence,resolveRound,topicIds,timeline}=h;
    const belongs=(topic,round)=>{const row=timeline.find(t=>t.roundId===round);return row&&[row.primaryTopicId,...row.secondaryTopicIds].includes(topic);};
    const directions=array(raw.directions??[],'未展开路径',Math.max(100,input.rounds.length*12)).map((d,i)=>{
      const field='directions['+i+']';
      if(!['unexplored','paused'].includes(d?.kind))fail('路径类型必须为 unexplored 或 paused','DIRECTION_KIND',{field});
      const source=resolveRound(d.sourceRoundId);
      if(!source||!belongs(d.parentTopicId,source.roundId))fail('路径来源轮次不存在，或不属于来源主题','DIRECTION_SOURCE',{field});
      const ev=evidence(d.evidence,'路径来源证据',source);
      if(!ev.length||ev.some(e=>e.roundId!==source.roundId))fail('路径需要来源轮次的连续原文证据','EVIDENCE_DIRECTION_SOURCE',{field});
      const discussionStatus=d.discussionStatus||'open';
      if(!['open','expanded'].includes(discussionStatus))fail('路径讨论状态无效','DIRECTION_STATUS',{field});
      let expandedTopicId=null,resolvedAtRoundId=null,resolutionEvidence=[];
      if(discussionStatus==='expanded'){
        const r=resolveRound(d.resolvedAtRoundId);
        if(!r||!topicIds.has(d.expandedTopicId)||!belongs(d.expandedTopicId,r.roundId)||input.rounds.indexOf(r)<input.rounds.indexOf(source))fail('路径展开目标或轮次无效','DIRECTION_RESOLUTION',{field});
        expandedTopicId=d.expandedTopicId;resolvedAtRoundId=r.roundId;
        resolutionEvidence=evidence(d.resolutionEvidence,'路径展开证据',r);
        if(!resolutionEvidence.length||resolutionEvidence.some(e=>e.roundId!==r.roundId))fail('路径展开缺少对应轮次原文证据','EVIDENCE_DIRECTION_RESOLUTION',{field});
      }
      return {id:string(d.id,'路径 ID',100),parentTopicId:d.parentTopicId,kind:d.kind,title:string(d.title,'路径标题',100),summary:string(d.summary,'路径说明',1200),sourceRoundId:source.roundId,evidence:ev,discussionStatus,expandedTopicId,resolvedAtRoundId,resolutionEvidence};
    });
    if(new Set(directions.map(d=>d.id)).size!==directions.length||new Set(directions.map(identity)).size!==directions.length)fail('路径 ID 或来源内容重复','DIRECTION_DUPLICATE');
    const updates=array(raw.directionUpdates??[],'路径展开更新',100).map(u=>{
      const previous=(input.context?.openDirections||[]).find(d=>d.id===u?.id),r=resolveRound(u?.resolvedAtRoundId);
      if(!previous||!r||!belongs(u.expandedTopicId,r.roundId))fail('路径更新引用未提供的历史路径，或目标不属于本段轮次','DIRECTION_UPDATE');
      const ev=evidence(u.evidence,'路径展开证据',r);
      if(!ev.length||ev.some(e=>e.roundId!==r.roundId))fail('路径展开缺少本段轮次证据','EVIDENCE_DIRECTION_UPDATE');
      return {id:u.id,expandedTopicId:u.expandedTopicId,resolvedAtRoundId:r.roundId,evidence:ev};
    });
    if(new Set(updates.map(u=>u.id)).size!==updates.length)fail('重复路径更新','DIRECTION_UPDATE_DUPLICATE');
    return raw.directions===undefined&&raw.directionUpdates===undefined?{}:{directions,directionUpdates:updates};
  }
  function memory(result,context){
    const topics=new Set((context.topics||[]).map(t=>t.id));
    const candidates=(result.directions||[]).filter(d=>d.discussionStatus!=='expanded'&&topics.has(d.parentTopicId));
    return {...context,openDirections:candidates.slice(-24).map(d=>({id:d.id,parentTopicId:d.parentTopicId,title:d.title,kind:d.kind,sourceRoundId:d.sourceRoundId})),directionCoverage:{scope:'selected-history-topics',available:candidates.length,provided:Math.min(24,candidates.length)}};
  }
  const api={transitions,identity,validate,memory};globalThis.AtlasDirections=api;if(typeof module!=='undefined')module.exports=api;
})();
