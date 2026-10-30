/* Local view only: no API calls, source mutation or invented relationships. */
(() => {
  const F=typeof AtlasFrontierView!=='undefined'?AtlasFrontierView:require('./frontier-view.js');
  const D=typeof AtlasDirections!=='undefined'?AtlasDirections:require('./directions.js');
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={flow:'推进',branch:'分支',return:'回归'};
  function model(record,result,Atlas) {
    const turns=Atlas.turns(record.messages),numbers=new Map(turns.map((t,i)=>[t.id,i+1]));
    const fallback=result?null:Atlas.graph(record);
    const nodes=result?result.topics.map(t=>({...t,label:t.name,turnIds:t.roundIds})):fallback.nodes.map(n=>({...n,id:n.label,name:n.label,brief:'',summary:'',roundIds:n.turnIds}));
    const first=n=>Math.min(...n.turnIds.map(id=>numbers.get(id)||Infinity));
    nodes.sort((a,b)=>first(a)-first(b));
    const byId=new Map(nodes.map((n,i)=>[n.id,{...n,code:'T'+String(i+1).padStart(2,'0')}]));
    const edges=(result?result.relations:fallback.edges).filter(e=>byId.has(e.from)&&byId.has(e.to)).map((e,i)=>({...e,index:i,atRoundId:e.atRoundId||e.turnId}));
    const children=new Map(nodes.map(n=>[n.id,[]])),parents=new Map();
    for(const n of nodes){const incoming=edges.filter(e=>e.to===n.id&&e.type!=='return'&&first(byId.get(e.from))<first(n)).sort((a,b)=>(a.type==='flow'?0:1)-(b.type==='flow'?0:1)||first(byId.get(a.from))-first(byId.get(b.from)));if(incoming[0]){parents.set(n.id,incoming[0].from);children.get(incoming[0].from).push(n.id);}}
    for(const [id,items]of children)items.sort((a,b)=>Number(!edges.some(e=>e.from===id&&e.to===a&&e.type==='flow'))-Number(!edges.some(e=>e.from===id&&e.to===b&&e.type==='flow'))||first(byId.get(a))-first(byId.get(b)));
    const widths=new Map();for(const n of [...nodes].reverse())widths.set(n.id,Math.max(1,children.get(n.id).reduce((sum,id)=>sum+widths.get(id),0)));
    const roots=nodes.filter(n=>!parents.has(n.id)),positions=new Map();let x=70;
    for(const root of roots){const stack=[{id:root.id,x,depth:0}];while(stack.length){const p=stack.pop();positions.set(p.id,{x:p.x,y:50+p.depth*154});let shift=0;for(const id of children.get(p.id)){stack.push({id,x:p.x+shift*280,depth:p.depth+1});shift+=widths.get(id);}}x+=widths.get(root.id)*280+24;}
    const width=Math.max(320,...[...positions.values()].map(p=>p.x+252+88)),height=Math.max(220,...[...positions.values()].map(p=>p.y+128+64));
    const timeline=result?result.timeline:turns.map((t,i)=>({roundId:t.id,title:record.annotations?.[t.id]?.topic||'第 '+(i+1)+' 轮对话'}));
    const base={nodes:[...byId.values()],byId,edges,roots,positions,width,height,numbers,timeline,ai:!!result};
    const layer=F.layout(base,(result?.directions||[]).filter(d=>byId.has(d.parentTopicId)&&numbers.has(d.sourceRoundId)));
    return {...layer.model,frontiers:layer};
  }
  function path(m,e){const a=m.positions.get(e.from),b=m.positions.get(e.to),sx=a.x+126,sy=a.y+128,ex=b.x+126,ey=b.y;
    if(e.type!=='return'&&ey>sy){const bend=Math.min(30,(ey-sy)/2);return 'M '+sx+' '+sy+' C '+sx+' '+(sy+bend)+' '+ex+' '+(ey-bend)+' '+ex+' '+ey;}
    const ay=a.y+64,by=b.y+64,right=m.width-35-e.index%8*4,left=25+e.index%8*4;
    if(a.x===b.x){const lane=a.x+266;return 'M '+(a.x+252)+' '+ay+' H '+lane+' V '+by+' H '+(b.x+252);}
    if(b.x>a.x){const bottom=m.height-18-e.index%8*4;return 'M '+a.x+' '+ay+' H '+left+' V '+bottom+' H '+right+' V '+by+' H '+(b.x+252);}
    const top=14+e.index%8*4;return 'M '+(a.x+252)+' '+ay+' H '+right+' V '+top+' H '+left+' V '+by+' H '+b.x;
  }
  function roundLink(m,id,key,branch){const row=m.timeline.find(r=>r.roundId===id),number=m.numbers.get(id);if(!row||!number)return '';return '<button class="graph-round" data-round="'+escape(id)+'" data-record="'+escape(key)+'" data-branch="'+escape(branch)+'"><span>R'+number+'</span><span>'+escape(row.title)+'</span><span aria-hidden="true">→</span></button>';}
  function detail(m,state,key,branch){
    const n=m.byId.get(state.selected),e=m.edges.find(e=>e.index===state.edge);
    if(!n)return '<div class="detail-intro"><p class="graph-kicker">主题目录</p><h2>沿着讨论往下看</h2><p class="graph-hint">点选主题回顾内容，或点小红点查看未展开的方向。</p>'+m.nodes.map(n=>'<button class="topic-pick" data-topic="'+escape(n.id)+'"><span>'+escape(n.code)+'</span><b>'+escape(n.name)+'</b><i>↗</i></button>').join('')+'</div>';
    const head='<button class="graph-back" data-graph-action="canvas">↑ 返回画布</button><button class="graph-back graph-close" data-graph-action="clear">收起详情</button>';
    if(e){return head+'<p class="graph-kicker">'+labels[e.type]+'</p><h2>'+escape(e.label||labels[e.type])+'</h2><p>'+escape(m.byId.get(e.from).name)+' → '+escape(m.byId.get(e.to).name)+'</p>'+(e.reason?'<p class="graph-summary">'+escape(e.reason)+'</p>':'')+roundLink(m,e.atRoundId,key,branch)+(e.evidence?.length?'<details class="graph-fold"><summary>原文依据</summary>'+e.evidence.map(v=>'<blockquote>'+escape(v.quote)+'</blockquote>').join('')+'</details>':'');}
    const related=m.edges.filter(e=>e.from===n.id||e.to===n.id);
    return head+'<p class="graph-kicker">'+escape(n.code)+' · '+n.turnIds.length+' 轮讨论</p><h2>'+escape(n.name)+'</h2>'+(n.summary?'<h3>主题详细摘要 · AI 归纳</h3><p class="graph-summary">'+escape(n.summary)+'</p>':'')+'<h3>讨论标题</h3>'+m.timeline.filter(r=>n.turnIds.includes(r.roundId)).map(r=>roundLink(m,r.roundId,key,branch)).join('')+(related.length?'<details class="graph-fold"><summary>关联关系 · '+related.length+'</summary>'+related.map(e=>'<button class="graph-relation" data-graph-edge="'+e.index+'">'+labels[e.type]+' · '+escape(m.byId.get(e.from).name)+' → '+escape(m.byId.get(e.to).name)+'</button>').join('')+'</details>':'');
  }
  function render(m,state,key,branch){
    const tasks=state.tasks||{},statuses=new Map((m.frontiers?.nodes||[]).map(d=>{const status=tasks[D.identity(d)]?.status;return [d.id,Object.hasOwn(D.transitions,status)?status:'pending'];}));
    const frontier=m.frontiers?.nodes.find(d=>d.id===state.frontier),layer=F.render(m.frontiers,state,statuses,state.frontier);
    const content=frontier?F.detail(frontier,m,statuses.get(frontier.id),key,branch):detail(m,state,key,branch);
    const connected=new Set(state.selected?[state.selected,...m.edges.filter(e=>e.from===state.selected||e.to===state.selected).flatMap(e=>[e.from,e.to])]:[]),query=(state.query||'').trim().toLowerCase();
    const matches=n=>(n.name+' '+n.brief+' '+n.summary).toLowerCase().includes(query);
    const paths=m.edges.filter(e=>e.type!=='return'||state.returns||e.from===state.selected||e.to===state.selected||e.index===state.edge).map(e=>'<path class="atlas-edge '+e.type+(state.selected&&e.from!==state.selected&&e.to!==state.selected?' dim':'')+'" data-graph-edge="'+e.index+'" d="'+path(m,e)+'" marker-end="url(#atlas-'+(e.type==='return'?'return':'arrow')+')"><title>'+escape(labels[e.type]+'：'+m.byId.get(e.from).name+' → '+m.byId.get(e.to).name+(e.label?' · '+e.label:''))+'</title></path>').join('');
    return '<div class="graph-controls"><input data-graph-search type="search" aria-label="搜索主题或路径" placeholder="搜索主题或路径…" value="'+escape(state.query||'')+'"><label><input data-graph-returns type="checkbox"'+(state.returns?' checked':'')+'>全部回归</label><button data-graph-action="out" aria-label="缩小关系图">−</button><button data-graph-action="in" aria-label="放大关系图">＋</button><button data-graph-action="fit">适应</button><button data-graph-action="expand">展开</button><button data-graph-action="reset">总览</button></div><div class="graph-content"><div class="graph-stage" tabindex="0" aria-label="可拖动和缩放的主题关系图"><div class="graph-world" style="width:'+m.width+'px;height:'+m.height+'px"><svg width="'+m.width+'" height="'+m.height+'" aria-label="主题连线"><defs><marker id="atlas-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#96a3bd"/></marker><marker id="atlas-return" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#b29873"/></marker></defs>'+paths+layer.paths+'</svg>'+m.nodes.map(n=>{const p=m.positions.get(n.id);return '<button class="atlas-node'+(state.selected===n.id?' selected':'')+(state.selected&&!connected.has(n.id)||query&&!matches(n)?' dim':'')+'" style="left:'+p.x+'px;top:'+p.y+'px" data-topic="'+escape(n.id)+'" aria-label="查看主题：'+escape(n.name)+'"><span class="atlas-code">'+n.code+' · '+n.turnIds.length+' 轮</span><b>'+escape(n.name)+'</b>'+(n.brief?'<span class="atlas-brief">'+escape(n.brief)+'</span>':'')+'</button>';}).join('')+layer.buttons+'</div><span class="graph-legend">实线：已讨论 · 红点：未展开 · 虚线末端：待继续 · 长虚线：回归'+(query?' · '+m.nodes.filter(matches).length+' 个匹配主题 · '+m.frontiers.nodes.filter(d=>F.matches(d,query)).length+' 个路径':'')+'</span></div><aside class="graph-detail" aria-label="主题详情">'+content+'</aside></div>';
  }
  const api={model,path,render,detail};globalThis.AtlasGraphView=api;if(typeof module!=='undefined')module.exports=api;
})();
