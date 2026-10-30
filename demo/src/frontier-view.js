/* Demo-only path layer. It never turns a suggestion into a discussed topic. */
(() => {
const width=214,height=94;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=d=>d.kind==='paused'?'待继续':'未展开';
const matches=(d,q)=>(d.title+' '+d.summary+' '+label(d)).toLowerCase().includes(q.trim().toLowerCase());
const overlap=(a,b)=>a.x<b.x+b.width+12&&a.x+a.width+12>b.x&&a.y<b.y+b.height+12&&a.y+a.height+12>b.y;
function layout(base,directions){
 const nodes=directions.filter(d=>d.initialStatus!=='expanded');
 const shift=nodes.some(d=>d.kind!=='paused')?90:0;
 const positions=new Map([...base.positions].map(([id,p])=>[id,{x:p.x+shift,y:p.y}]));
 const boxes=[...positions.values()].map(p=>({...p,width:252,height:128}));
 const ends=new Map(),groups=new Map();
 for(const d of nodes){
  const parent=positions.get(d.parentTopicId);if(!parent)throw new Error('Missing path origin');
  const rank=groups.get(d.parentTopicId)||0;groups.set(d.parentTopicId,rank+1);
  const paused=d.kind==='paused',w=paused?width:44,h=paused?height:44;
  const right=d.side==='right',anchor=parent.x+(right?252:0),sign=right?1:-1;
  const p=paused?{x:parent.x+19,y:parent.y+170}:{x:right?parent.x+282:parent.x-74,y:parent.y+14+rank*56};
  while(boxes.some(b=>overlap({...p,width:w,height:h},b)))p.y+=paused?134:56;
  const cy=p.y+h/2;
  const path=paused?'M '+(parent.x+126)+' '+(parent.y+128)+' V '+p.y:'M '+anchor+' '+(parent.y+64)+' C '+(anchor+sign*30)+' '+(parent.y+64)+' '+(anchor+sign*28)+' '+cy+' '+(p.x+w/2)+' '+cy;
  ends.set(d.id,{...p,width:w,height:h,path});boxes.push({...p,width:w,height:h});
 }
 const model={...base,positions,width:Math.max(base.width+shift,...boxes.map(b=>b.x+b.width+64)),height:Math.max(base.height,...boxes.map(b=>b.y+b.height+50))};
 return {model,ends,nodes};
}
function render(layer,state,statuses,selected){
 const q=(state.query||'').trim(),related=id=>!state.selected||state.selected===id;
 const paths=layer.nodes.map(d=>{const p=layer.ends.get(d.id),dim=(!related(d.parentTopicId)&&selected!==d.id)||(q&&!matches(d,q));return '<path class="frontier-edge '+escape(d.kind||'unexplored')+(dim?' dim':'')+'" data-frontier="'+escape(d.id)+'" d="'+p.path+'"><title>'+escape(label(d)+'：'+d.title)+'</title></path>';}).join('');
 const buttons=layer.nodes.map(d=>{const p=layer.ends.get(d.id),task=statuses.get(d.id),note=task==='todo'?'待办':task==='done'?'待办已完成':task==='ignored'?'暂不考虑':'';return '<button class="frontier-node '+escape(d.kind||'unexplored')+' '+escape(task)+(selected===d.id?' selected':'')+((!related(d.parentTopicId)&&selected!==d.id||q&&!matches(d,q))?' dim':'')+'" style="left:'+p.x+'px;top:'+p.y+'px;width:'+p.width+'px;height:'+p.height+'px" data-frontier="'+escape(d.id)+'" aria-label="查看'+label(d)+'路径：'+escape(d.title)+'">'+(d.kind!=='paused'?'<span class="frontier-dot" aria-hidden="true"></span><span class="frontier-tooltip" aria-hidden="true">'+escape(d.title)+'</span>':'<span class="frontier-kind">'+label(d)+'</span>'+(note?'<span class="frontier-task">'+note+'</span>':'')+'<b>'+escape(d.title)+'</b><span class="frontier-source">R'+escape(d.sourceRoundId.slice(1))+(d.kind==='paused'?' 留下的问题':' 提出的方向')+'</span>')+'</button>';}).join('');
 return {paths,buttons};
}
function detail(d,data,status){
 const parent=data.topics.find(t=>t.id===d.parentTopicId),r=data.rounds.find(r=>r.id===d.sourceRoundId);
 const actions={pending:[['todo','加入待办'],['ignored','暂不考虑']],todo:[['done','完成待办'],['pending','移出待办']],ignored:[['pending','恢复方向']],done:[['todo','重新加入待办']]}[status]||[];
 const labels={pending:'尚未加入待办',todo:'已加入待办',ignored:'暂不考虑',done:'待办已完成 · 手动'};
 return '<button class="graph-back" data-topic="'+escape(parent.id)+'">← 返回主题</button><button class="graph-back graph-close" data-graph-action="clear">收起详情</button><p class="graph-kicker">'+label(d)+'路径 · R'+r.number+'</p><h2>'+escape(d.title)+'</h2><p class="frontier-origin">从「'+escape(parent.name)+'」'+(d.kind==='paused'?'继续，留下一个问题。':'分出的方向。')+'</p><p class="graph-summary">'+escape(d.summary)+'</p><button class="graph-round" data-round="'+escape(r.id)+'"><span>R'+r.number+'</span><span>回到提出处 · '+escape(r.title)+'</span><span>→</span></button><h3>来源摘录 · 演示改写</h3><blockquote class="frontier-quote">'+escape(d.quote)+'</blockquote><div class="frontier-action-head"><span>行动安排</span><b>'+labels[status]+'</b></div><div class="direction-actions">'+actions.map(([next,text])=>'<button data-direction-id="'+escape(d.id)+'" data-direction-action="'+next+'">'+text+'</button>').join('')+'</div><p class="frontier-note">待办状态与讨论进度独立。加入或完成待办，不会把路径端点变成已讨论主题。</p><div class="direction-footer"><span>仅本页演示，刷新重置。</span><button data-direction-reset>重置示例</button></div>';
}
const api={layout,render,detail,matches,label,overlap};globalThis.AtlasFrontierView=api;if(typeof module!=='undefined')module.exports=api;
})();
