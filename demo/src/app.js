(() => {
'use strict';
const D=TopicAtlasDemoData,G=AtlasGraphView,F=AtlasFrontierView,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseModel=G.model({messages:[]},D.result,{turns:()=>D.rounds.map(r=>({id:r.id}))});
const state={selected:null,edge:null,query:'',returns:false,x:0,y:0,scale:1},ui={view:'graph',timelineQuery:'',target:null,viewport:false,frontier:null};
let gesture=null,suppressClick=false;
const directionStatus=new Map((D.directions||[]).map(d=>[d.id,d.initialStatus]));
const directionLabels={pending:'尚未加入待办',todo:'已加入待办',ignored:'暂不考虑',expanded:'已展开',done:'待办已完成 · 手动'};
const directionTransitions={pending:['todo','ignored'],todo:['pending','done'],ignored:['pending'],done:['todo'],expanded:[]};
const frontierLayer=F.layout(baseModel,D.directions||[]),model=frontierLayer.model;
function say(text){$('announcement').textContent=text;}
function stage(){return $('graph-panel').querySelector('.graph-stage');}
function transform(){const world=$('graph-panel').querySelector('.graph-world');if(world)world.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;}
function fit(overview=true){const box=stage();if(!box)return;state.scale=Math.min(1,Math.max(.3,Math.min((box.clientWidth-30)/model.width,(box.clientHeight-45)/model.height)));const readable=!overview&&box.clientWidth<600;if(readable)state.scale=Math.max(.72,state.scale);state.x=(box.clientWidth-model.width*state.scale)/2;state.y=readable?20:(box.clientHeight-model.height*state.scale)/2-5;ui.viewport=true;transform();}
function zoom(factor){const box=stage();if(!box)return;const next=Math.min(1.65,Math.max(.3,state.scale*factor)),cx=box.clientWidth/2,cy=box.clientHeight/2;state.x=cx-(cx-state.x)*next/state.scale;state.y=cy-(cy-state.y)*next/state.scale;state.scale=next;transform();say('画布缩放 '+Math.round(next*100)+'%');}
function renderGraph(focusId){
 const search=$('graph-panel').querySelector('[data-graph-search]'),focused=search===document.activeElement,start=search?.selectionStart;
 $('graph-panel').innerHTML=G.render(model,state,'demo','current');
 const searchbox=graph.querySelector('[data-graph-search]');searchbox.setAttribute('aria-label','搜索主题或路径');searchbox.placeholder='搜索主题或路径…';
 const detail=$('graph-panel').querySelector('.graph-detail');
 if(!state.selected)detail.innerHTML='<div class="detail-intro"><div class="eyebrow">TOPIC DIRECTORY</div><h2>从一个主题开始</h2><p>点选节点，或从这里挑一个主题。</p>'+model.nodes.map(n=>'<button class="topic-pick" data-topic="'+esc(n.id)+'"><span>'+esc(n.code)+'</span><b>'+esc(n.name)+'</b><i aria-hidden="true">↗</i></button>').join('')+'<p class="canvas-help">实线：推进 / 分支<br>虚线：回到已经讨论过的主题</p></div>';
 if(!state.selected){detail.querySelector('h2').textContent='沿着讨论往下看';detail.querySelector('p').textContent='点选主题回顾已讨论内容，或点小红点查看未展开的方向。';detail.querySelector('.canvas-help')?.remove();}
 if(ui.frontier){const d=D.directions.find(d=>d.id===ui.frontier);if(d)detail.innerHTML=F.detail(d,D,directionStatus.get(d.id));}
 detail.setAttribute('aria-label',ui.frontier?'路径端点详情':'主题详情');
 const frontierMarkup=F.render(frontierLayer,state,directionStatus,ui.frontier);
 graph.querySelector('.graph-world svg').insertAdjacentHTML('beforeend',frontierMarkup.paths);
 graph.querySelector('.graph-world').insertAdjacentHTML('beforeend',frontierMarkup.buttons);
 const legend=graph.querySelector('.graph-legend');legend.textContent='实线：已讨论 · 红点：未展开 · 虚线末端：待继续 · 长虚线：回归';
 const query=state.query.trim().toLowerCase(),matches=model.nodes.filter(n=>(n.name+' '+n.brief+' '+n.summary).toLowerCase().includes(query));
 if(query&&!matches.length&&!frontierLayer.nodes.some(d=>F.matches(d,query))){const note=document.createElement('p');note.className='graph-no-match';note.textContent='没有匹配的主题或路径。清空搜索可回到完整关系图。';$('graph-panel').prepend(note);}
 if(!ui.viewport)fit(false);else transform();
 if(focused){const input=$('graph-panel').querySelector('[data-graph-search]');input.focus();if(start!==null)input.setSelectionRange(start,start);}
 if(focusId)$('graph-panel').querySelector('.atlas-node[data-topic="'+focusId+'"]')?.focus({preventScroll:true});
}
function timelineRows(query){const q=query.trim().toLowerCase();return D.rounds.filter(r=>(r.title+' '+r.user+' '+r.assistant+' '+D.topics.find(t=>t.id===r.topic).name).toLowerCase().includes(q));}
function renderTimeline(){
 const rounds=timelineRows(ui.timelineQuery);
 $('timeline-count').textContent=ui.timelineQuery?rounds.length+' / '+D.rounds.length+' 轮匹配':'时间顺序 · R01 → R13';
 $('timeline-list').innerHTML=rounds.length?rounds.map(r=>'<article class="timeline-round'+(ui.target===r.id?' target':'')+'" id="round-'+r.id+'" tabindex="-1"><span class="round-number">R'+String(r.number).padStart(2,'0')+'</span><details'+(ui.target===r.id?' open':'')+'><summary><span class="round-heading-label">'+esc(r.title)+'</span><span class="round-topic">'+esc(D.topics.find(t=>t.id===r.topic).name)+'</span><span class="round-toggle" aria-hidden="true">＋</span></summary><div class="round-messages"><div class="dialogue"><span>You · 示例</span><p>'+esc(r.user)+'</p></div><div class="dialogue assistant"><span>AI · 示例</span><p>'+esc(r.assistant)+'</p></div><div class="sample-note">为展示交互改写，非聊天原文。</div></div></details></article>').join(''):'<div class="timeline-empty">没有找到对应讨论。<button data-clear-timeline>清空搜索</button></div>';
}
function setView(view){ui.view=view;for(const name of ['graph','timeline']){$(name+'-panel').hidden=name!==view;$(name+'-tab').setAttribute('aria-selected',String(name===view));$(name+'-tab').tabIndex=name===view?0:-1;}$('view-hint').textContent=view==='graph'?'点选主题查看摘要；拖动空白处浏览画布。':'按轮次阅读，点击标题展开对应示例。';if(view==='timeline')renderTimeline();else{renderGraph();if(!stage().clientWidth)requestAnimationFrame(fit);}say(view==='graph'?'关系图视图':'时间线列表视图');}
function goRound(id){const round=D.rounds.find(r=>r.id===id);if(!round)return;ui.target=id;ui.timelineQuery='';$('timeline-search').value='';setView('timeline');const node=$('round-'+id);node?.focus({preventScroll:true});node?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});say('已定位到 R'+round.number+'，'+round.title);}
function selectTopic(id,focus=false){if(!model.byId.has(id))return;ui.frontier=null;state.selected=id;state.edge=null;renderGraph(focus?id:null);say('已选择主题：'+model.byId.get(id).name);}
const graph=$('graph-panel');
graph.addEventListener('click',event=>{
 if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;return;}
 const directionAction=event.target.closest('[data-direction-action]');
 if(directionAction){const id=directionAction.dataset.directionId,next=directionAction.dataset.directionAction;if(directionTransitions[directionStatus.get(id)]?.includes(next)){directionStatus.set(id,next);renderGraph();graph.querySelector('[data-direction-action]')?.focus({preventScroll:true});say('方向状态已更新为'+directionLabels[next]);}return;}
 if(event.target.closest('[data-direction-reset]')){for(const d of D.directions||[])directionStatus.set(d.id,d.initialStatus);renderGraph();graph.querySelector('[data-direction-reset]')?.focus({preventScroll:true});say('已恢复演示方向的初始状态');return;}
 const target=event.target.closest('[data-frontier],[data-topic],[data-graph-edge],[data-round],[data-graph-action]');if(!target)return;
 if(target.dataset.frontier)return selectFrontier(target.dataset.frontier,true);
 if(target.dataset.round)return goRound(target.dataset.round);
 if(target.dataset.topic)return selectTopic(target.dataset.topic,target.classList.contains('atlas-node'));
 if(target.dataset.graphEdge!==undefined){const edge=model.edges.find(e=>e.index===Number(target.dataset.graphEdge));if(!edge)return;ui.frontier=null;state.selected=edge.to;state.edge=edge.index;renderGraph();return;}
 const action=target.dataset.graphAction;
 if(action==='in')zoom(1.18);else if(action==='out')zoom(1/1.18);else if(action==='fit')fit();
 else if(action==='clear'){ui.frontier=null;state.selected=null;state.edge=null;renderGraph();}
 else if(action==='reset'){ui.frontier=null;Object.assign(state,{selected:null,edge:null,query:'',returns:false});renderGraph();fit();say('已回到完整关系图');}
 else if(action==='canvas'){stage().scrollIntoView({behavior:'smooth',block:'nearest'});stage().focus({preventScroll:true});}
});
graph.addEventListener('input',e=>{if(e.target.matches('[data-graph-search]')){state.query=e.target.value;renderGraph();say(model.nodes.filter(n=>(n.name+' '+n.brief+' '+n.summary).toLowerCase().includes(state.query.trim().toLowerCase())).length+' 个匹配主题，'+frontierLayer.nodes.filter(d=>F.matches(d,state.query)).length+' 个路径端点');}});
graph.addEventListener('change',e=>{if(e.target.matches('[data-graph-returns]')){state.returns=e.target.checked;renderGraph();}});
graph.addEventListener('pointerdown',e=>{suppressClick=false;if(e.button!==0||e.isPrimary===false||e.target.closest('button,a,input,label,summary,[data-graph-edge],[data-frontier]'))return;const area=e.target.closest('.graph-stage');if(!area)return;e.preventDefault();gesture={id:e.pointerId,area,startX:e.clientX,startY:e.clientY,x:state.x,y:state.y,moved:false};area.setPointerCapture(e.pointerId);});
graph.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.id)return;const dx=e.clientX-gesture.startX,dy=e.clientY-gesture.startY;if(!gesture.moved&&Math.hypot(dx,dy)<4)return;gesture.moved=true;gesture.area.classList.add('is-panning');state.x=gesture.x+dx;state.y=gesture.y+dy;transform();});
function finishPointer(e){if(!gesture||e.pointerId!==gesture.id)return;suppressClick=gesture.moved;gesture.area.classList.remove('is-panning');if(gesture.area.hasPointerCapture(e.pointerId))gesture.area.releasePointerCapture(e.pointerId);gesture=null;}
graph.addEventListener('pointerup',finishPointer);graph.addEventListener('pointercancel',finishPointer);graph.addEventListener('lostpointercapture',e=>{if(gesture?.id===e.pointerId){gesture.area.classList.remove('is-panning');gesture=null;}});
graph.addEventListener('keydown',e=>{if(e.target!==stage())return;const actions={ArrowLeft:()=>{state.x+=35;},ArrowRight:()=>{state.x-=35;},ArrowUp:()=>{state.y+=35;},ArrowDown:()=>{state.y-=35;},Home:fit,'+':()=>zoom(1.18),'=':()=>zoom(1.18),'-':()=>zoom(1/1.18)};if(actions[e.key]){e.preventDefault();actions[e.key]();transform();}if(e.key==='Escape'){ui.frontier=null;state.selected=null;state.edge=null;renderGraph();}});
for(const name of ['graph','timeline']){$(name+'-tab').addEventListener('click',()=>setView(name));$(name+'-tab').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'graph':e.key==='End'?'timeline':name==='graph'?'timeline':'graph';setView(next);$(next+'-tab').focus();}});}
$('timeline-search').addEventListener('input',e=>{ui.timelineQuery=e.target.value;ui.target=null;renderTimeline();});
function resetTimeline(){ui.timelineQuery='';ui.target=null;$('timeline-search').value='';renderTimeline();}
$('timeline-reset').addEventListener('click',resetTimeline);$('timeline-list').addEventListener('click',e=>{if(e.target.closest('[data-clear-timeline]'))resetTimeline();});
$('tour').addEventListener('click',()=>{state.query='';setView('graph');selectTopic('architecture');$('experience').scrollIntoView({behavior:'smooth',block:'start'});say('已选中主题中心架构。点击右侧 R8 标题可回到重新讨论这个主题的轮次。');});
function selectFrontier(id,focus=false){const d=frontierLayer.nodes.find(d=>d.id===id);if(!d)return;ui.frontier=id;state.selected=d.parentTopicId;state.edge=null;renderGraph();const box=stage(),p=frontierLayer.ends.get(id),left=state.x+p.x*state.scale,top=state.y+p.y*state.scale;if(box.clientWidth<600||left<10||top<10||left+p.width*state.scale>box.clientWidth-10||top+p.height*state.scale>box.clientHeight-20){state.scale=Math.max(.8,state.scale);state.x=box.clientWidth/2-(p.x+p.width/2)*state.scale;state.y=box.clientHeight/2-(p.y+p.height/2)*state.scale;transform();}if(focus)graph.querySelector('button[data-frontier="'+id+'"]')?.focus({preventScroll:true});say('已选择'+F.label(d)+'路径：'+d.title);}
$('directions-tour').addEventListener('click',()=>{state.query='';setView('graph');selectFrontier('cross-chat-library');stage().scrollIntoView({behavior:'smooth',block:'nearest'});});
window.addEventListener('resize',()=>{if(ui.view==='graph')fit(false);});renderGraph();renderTimeline();
})();
