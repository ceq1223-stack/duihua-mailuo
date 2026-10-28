/* Variable-height timeline window; only mounted rows own DOM/body pages. */
(() => {
  class Heights {
    constructor(count,estimate=260){this.values=new Float64Array(count).fill(estimate);this.tree=new Float64Array(count+1);for(let i=0;i<count;i++)this.add(i,estimate);}
    add(i,n){for(i++;i<this.tree.length;i+=i&-i)this.tree[i]+=n;}
    set(i,n){if(i<0||i>=this.values.length||!Number.isFinite(n)||n<1)return;const diff=n-this.values[i];if(Math.abs(diff)<1)return;this.values[i]=n;this.add(i,diff);}
    prefix(n){let sum=0;for(;n>0;n-=n&-n)sum+=this.tree[n];return sum;}
    at(y){let index=0,sum=0,bit=1;while(bit*2<this.tree.length)bit*=2;for(;bit;bit>>=1){const next=index+bit;if(next<this.tree.length&&sum+this.tree[next]<=y){index=next;sum+=this.tree[next];}}return Math.min(index,Math.max(0,this.values.length-1));}
  }
  function create(host,{renderRow,onMount=()=>{},onUnmount=()=>{}}){
    let rows=[],heights=new Heights(0),context='',active=true,start=-1,end=-1,frame=false,resize,mounted=new Map(),topGap,bottomGap;
    const doc=host.ownerDocument||document,root=()=>doc.scrollingElement||doc.documentElement;
    function viewport(){const scroll=root()?.scrollTop||0,rect=host.getBoundingClientRect?.(),header=doc.querySelector?.('header')?.getBoundingClientRect?.().height||0;return {top:Math.max(0,scroll+header-((rect?.top||0)+scroll)),height:Math.max(300,(globalThis.innerHeight||800)-header)};}
    function schedule(){if(frame||!active)return;frame=true;(globalThis.requestAnimationFrame||((f)=>setTimeout(f,16)))(()=>{frame=false;draw();});}
    function measure(){
      const v=viewport(),anchor=heights.at(v.top),before=heights.prefix(anchor);
      for(const node of host.querySelectorAll?.('.turn[data-window-index]')||[]){const h=node.getBoundingClientRect?.().height;if(h)heights.set(Number(node.dataset.windowIndex),h+20);}
      const shift=heights.prefix(anchor)-before;if(shift&&root())root().scrollTop+=shift;
      gaps();schedule();
    }
    function gaps(){const top=host.querySelector?.('[data-window-top]'),bottom=host.querySelector?.('[data-window-bottom]');if(top)top.style.height=heights.prefix(Math.max(0,start))+'px';if(bottom)bottom.style.height=(heights.prefix(rows.length)-heights.prefix(Math.max(0,end)))+'px';}
    function draw(force=false,focusIndex=null){
      if(!active)return;
      const v=viewport(),a=focusIndex===null?heights.at(Math.max(0,v.top-700)):Math.max(0,focusIndex-3),b=focusIndex===null?Math.min(rows.length,heights.at(v.top+v.height+700)+1):Math.min(rows.length,focusIndex+8);
      if(!force&&a===start&&b===end){gaps();return;}
      const old=rows.slice(Math.max(0,start),Math.max(0,end)).map(r=>r.id);resize?.disconnect();
      start=a;end=b;
      if(host.replaceChildren&&doc.createElement){
        if(!topGap){topGap=doc.createElement('div');topGap.dataset.windowTop='';topGap.className='timeline-gap';topGap.setAttribute('aria-hidden','true');bottomGap=doc.createElement('div');bottomGap.dataset.windowBottom='';bottomGap.className='timeline-gap';bottomGap.setAttribute('aria-hidden','true');}
        const next=new Map(),nodes=[],removed=new Set(mounted.keys());
        rows.slice(a,b).forEach((row,i)=>{const html=renderRow(row,a+i),existing=mounted.get(row.id);let node;
          if(existing?.html===html){node=existing.node;removed.delete(row.id);}else{const template=doc.createElement('template');template.innerHTML=html;node=template.content.firstElementChild;}
          node.setAttribute?.('aria-setsize',String(rows.length));next.set(row.id,{node,html});nodes.push(node);
        });
        onUnmount([...removed]);host.replaceChildren(topGap,...nodes,bottomGap);mounted=next;gaps();
      }else{onUnmount(old);host.innerHTML=`<div data-window-top class="timeline-gap" aria-hidden="true" style="height:${heights.prefix(a)}px"></div>`+rows.slice(a,b).map((row,i)=>renderRow(row,a+i)).join('')+`<div data-window-bottom class="timeline-gap" aria-hidden="true" style="height:${heights.prefix(rows.length)-heights.prefix(b)}px"></div>`;}
      if(typeof ResizeObserver!=='undefined'){
        resize=new ResizeObserver(measure);for(const node of host.querySelectorAll('.turn[data-window-index]'))resize.observe(node);
      }
      onMount(rows.slice(a,b));
    }
    return {
      set(next,key){const previous=new Map(rows.map((r,i)=>[r.id,heights.values[i]]));if(context!==key){onUnmount([...mounted.keys()]);mounted.clear();}rows=next;heights=new Heights(rows.length);if(context===key)rows.forEach((r,i)=>{if(previous.has(r.id))heights.set(i,previous.get(r.id));});context=key;start=end=-1;draw(true);},
      activate(value){if(active===value)return;active=value;if(!active){resize?.disconnect();onUnmount(rows.slice(Math.max(0,start),Math.max(0,end)).map(r=>r.id));host.innerHTML='';mounted.clear();start=end=-1;}else draw(true);},
      reveal(id){const index=rows.findIndex(r=>r.id===id);if(index<0)return false;active=true;draw(true,index);const r=root(),rect=host.getBoundingClientRect?.();if(r&&rect)r.scrollTop=Math.max(0,r.scrollTop+rect.top+heights.prefix(index)-150);return true;},
      refresh:()=>draw(true),measure,range:()=>({start,end,total:rows.length}),scroll:schedule,
      clear(){resize?.disconnect();onUnmount(rows.map(r=>r.id));mounted.clear();rows=[];heights=new Heights(0);start=end=-1;host.innerHTML='';}
    };
  }
  globalThis.AtlasTimeline={Heights,create};
  if(typeof module!=='undefined')module.exports=globalThis.AtlasTimeline;
})();
