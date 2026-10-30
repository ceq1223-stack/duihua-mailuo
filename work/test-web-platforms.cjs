const assert=require('node:assert/strict');
const A=require('../outputs/topic-atlas-extension/core.js');
require('../outputs/topic-atlas-extension/platforms.js');
const P=globalThis.AtlasPlatforms;
let count=0;
function test(label,fn){fn();count++;console.log('PASS',label);}
class Node {
 constructor(tag,attrs={},value='',children=[]){this.tagName=tag.toUpperCase();this.attrs=attrs;this.value=value;this.children=children;for(const c of children)c.parentElement=this;}
 get id(){return this.attrs.id||'';}get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
 getAttribute(k){return this.attrs[k]??null;}
 matches(s){if(s.startsWith('.'))return (this.attrs.class||'').split(' ').includes(s.slice(1));const m=s.match(/^(\w[\w-]*)?\[([^=\]]+)(?:="([^"]*)")?\]$/);if(m)return (!m[1]||this.tagName.toLowerCase()===m[1])&&this.attrs[m[2]]!==undefined&&(m[3]===undefined||this.attrs[m[2]]===m[3]);return s==='*'||this.tagName.toLowerCase()===s;}
 querySelectorAll(s){const selectors=s.split(',').map(x=>x.trim()),out=[];const visit=n=>{for(const c of n.children){if(selectors.some(s=>c.matches(s)))out.push(c);visit(c);}};visit(this);return out;}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 closest(s){for(let n=this;n;n=n.parentElement)if(s.split(',').some(s=>n.matches(s.trim())))return n;return null;}
 cloneNode(){const n=new Node(this.tagName,{...this.attrs},this.value,this.children.map(c=>c.cloneNode()));n.ownerDocument=this.ownerDocument;return n;}
 appendChild(n){this.children.push(n);n.parentElement=this;}
 remove(){this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
}
function page({turn='0123456789abcdef',busy='false',copy=true,formal=true,response='r_answer',hidden=false,question='问题',answer='正式回答'}={}){
 const body=new Node('div',{class:'markdown markdown-main-panel','aria-busy':busy},answer,[new Node('button',{},'不应采集的工具栏')]);
 const user=new Node('user-query',{},'',[new Node('div',{class:'query-text'},question)]);
 const ai=new Node('model-response',hidden?{hidden:''}:{},'',[new Node('thinking-overlay',{},'内部思考不应采集'),...(formal?[new Node('message-content',{id:'message-content-id-'+response},'',[body])]:[]),...(copy?[new Node('button',{'aria-label':'复制'},'复制')]:[])]);
 const doc=new Node('document',{},'',[new Node('div',turn?{id:turn}:{},'',[user,ai])]);doc.createTextNode=text=>new Node('text',{},text);
 const link=n=>{n.ownerDocument=doc;for(const c of n.children)link(c);};link(doc);return {doc,body,user,ai};
}
test('Observed Gemini native turn and formal response markers identify roles and exclude thoughts/toolbars',()=>{const {doc,body}=page();const messages=A.extract(doc,'Gemini');assert.equal(messages.length,2);assert.equal(messages[0].nativeId,'0123456789abcdef');assert.equal(messages[1].nativeId,'message-content-id-r_answer');assert.equal(messages[1].text,'正式回答');assert.equal(messages[1]._node,body);assert.equal(messages[1].channel,'final');assert.equal(messages[1].status,'finished');});
test('Streaming or absent completion markers are not treated as finished',()=>{assert.equal(P.gemini(page({busy:'true'}).doc)[1].status,'in_progress');assert.equal(P.gemini(page({copy:false}).doc)[1].status,'unknown');});
test('Thought-only responses and hidden responses never become source answers',()=>{assert.equal(P.gemini(page({formal:false}).doc).length,1);assert.equal(P.gemini(page({hidden:true}).doc).length,1);});
test('Formal answers preserve code that happens to mention thinking or tools',()=>{const answer='thinking-overlay 是组件名称；bash 命令是答案的一部分';assert.equal(P.gemini(page({answer}).doc)[1].text,answer);});
test('Identical prompts with different verified native turns are distinct',()=>{const first=P.gemini(page().doc).map(({_node,...m})=>m),second=P.gemini(page({turn:'fedcba9876543210',response:'r_later'}).doc).map(({_node,...m})=>m);const a=P.merge(null,[...first,...second],'first');const b=P.merge(a,second,'second');assert.equal(A.turns(b.messages).length,2);assert.equal(b.messages.length,4);});
test('Gemini streaming refresh preserves firstSeen and completion state for automatic queue triggers',()=>{const a=P.merge(null,P.gemini(page({busy:'true',answer:'正式'}).doc),'first');const b=P.merge(a,P.gemini(page().doc),'last');assert.equal(b.messages.length,2);assert.equal(b.messages[1].firstSeenAt,'first');assert.equal(b.messages[1].status,'finished');assert.equal(b.messages[1].text,'正式回答');assert.equal(b.source.completeness,'loaded-messages');});
test('Editing an earlier native user turn removes unconfirmed old descendants from active path',()=>{const old=P.merge(null,[...P.gemini(page().doc),...P.gemini(page({turn:'fedcba9876543210',response:'later'}).doc)],'a');const incoming=P.gemini(page({question:'编辑后的问题',response:'edited'}).doc);const current=P.merge(old,incoming,'c');assert.equal(current.messages.length,2);assert(!current.messages.some(m=>m.turnId==='fedcba9876543210'));assert.equal(current.messages[0].text,'编辑后的问题');});
test('Regeneration cannot combine old and new AI versions into one round',()=>{const old=P.merge(null,P.gemini(page().doc),'a');const current=P.merge(old,P.gemini(page({response:'regenerated',answer:'新回答'}).doc),'b');assert.equal(current.messages.length,2);assert.equal(A.turns(current.messages)[0].assistants[0].text,'新回答');});
test('Missing native turn identity does not inherit an unverified archived branch',()=>{const old=P.merge(null,P.gemini(page().doc),'a');const current=P.merge(old,P.gemini(page({turn:null,response:'new'}).doc),'b');assert.equal(current.source.pathConfidence,'unverified-identity');assert.equal(current.messages.length,2);});
test('Legacy migration keeps unique exact-text annotation IDs but does not copy unseen legacy history',()=>{const old={messages:[{id:'old-user',role:'user',text:'问题'},{id:'unseen',role:'user',text:'旧的未加载分支'}]};const current=P.merge(old,P.gemini(page().doc),'now');assert.equal(current.messages[0].id,'old-user');assert.equal(current.messages.length,2);});
function deepPage({key='2',answer='正式回答',question='问题',userClass='d29f3d7d',formal=true}={}){
 const userBody=new Node('div',{class:'fbb737a4'},question);
 const thought=new Node('div',{class:'ds-think-content'},'不应收录的内部思考',[new Node('div',{class:'ds-markdown'},'不应收录的思考正文')]);
 const answerBody=new Node('div',{class:'ds-markdown ds-assistant-message-main-content'},answer);
 const user=new Node('div',{class:'ds-message '+userClass},'',[userBody]);
 const ai=new Node('div',{class:'ds-message'},'',[thought,...(formal?[answerBody]:[])]);
 const doc=new Node('document',{},'',[new Node('div',{'data-virtual-list-item-key':'1'},'',[user]),new Node('div',{'data-virtual-list-item-key':key},'',[ai])]);doc.createTextNode=t=>new Node('text',{},t);
 const link=n=>{n.ownerDocument=doc;for(const c of n.children)link(c);};link(doc);return {doc,answerBody};
}
test('DeepSeek recognizes only its exact HTTPS host and observed saved-conversation route',()=>{assert(A.conversation('https://chat.deepseek.com/a/chat/s/00000000-1111-4222-8333-444444444444').key);assert(A.conversation('https://chat.deepseek.com/').draft);assert(A.conversation('https://chat.deepseek.com/sign_in').draft);assert.equal(A.conversation('https://chat.deepseek.com.evil.example/a/chat/s/abc'),null);assert.equal(A.conversation('http://chat.deepseek.com/a/chat/s/a'),null);});
test('DeepSeek uses positive user markers and only the formal answer, never alternate Markdown blocks',()=>{const {doc,answerBody}=deepPage();const messages=A.extract(doc,'DeepSeek');assert.deepEqual(messages.map(m=>m.role),['user','assistant']);assert.equal(messages[1].text,'正式回答');assert.equal(messages[1]._node,answerBody);assert.equal(messages[1].nativeId,null);assert.equal(messages[1].status,'unknown');});
test('DeepSeek user layout changes do not make unknown containers into guessed users',()=>{const messages=P.deepseek(deepPage({userClass:'changed'}).doc);assert.equal(messages.length,1);assert.equal(messages[0].role,'assistant');});
test('DeepSeek thought-only output does not create an AI answer',()=>{assert.equal(P.deepseek(deepPage({formal:false}).doc).length,1);});
test('DeepSeek regeneration replaces the old reply instead of aggregating versions',()=>{const old=P.merge(null,P.deepseek(deepPage().doc),'a','DeepSeek');const current=P.merge(old,P.deepseek(deepPage({key:'4',answer:'重生成的回答'}).doc),'b','DeepSeek');assert.equal(current.messages.length,2);assert.equal(A.turns(current.messages)[0].assistants[0].text,'重生成的回答');assert.equal(current.source.completion,'unknown');});
test('Unanchored virtual snapshots do not silently concatenate different possible paths',()=>{const old=P.merge(null,P.gemini(page().doc),'a');const current=P.merge(old,P.gemini(page({turn:'fedcba9876543210',response:'unrelated'}).doc),'b');assert.equal(current.messages.length,2);});
require('../outputs/topic-atlas-extension/locator.js');
test('DeepSeek locate targets only the matching formal DOM message with matching original text',()=>{const {doc,answerBody}=deepPage();const message=P.deepseek(doc)[1];assert.equal(globalThis.AtlasLocator.find(doc,message,'DeepSeek'),answerBody);assert.equal(globalThis.AtlasLocator.find(deepPage({answer:'复用同一DOM序号的新正文'}).doc,message,'DeepSeek'),null);});
test('Gemini locate does not treat an edited user turn with reused container ID as the old original',()=>{const {doc}=page();const message=P.gemini(doc)[0];assert.equal(globalThis.AtlasLocator.find(doc,message,'Gemini'),message._node);assert.equal(globalThis.AtlasLocator.find(page({question:'已编辑的用户内容'}).doc,message,'Gemini'),null);});
test('Legacy migrated Gemini message IDs remain stable across repeated native snapshots',()=>{const old={messages:[{id:'old-user',role:'user',text:'问题'}]};const first=P.merge(old,P.gemini(page().doc),'first');const second=P.merge(first,P.gemini(page().doc),'second');assert.equal(second.messages[0].id,'old-user');assert.equal(second.messages[0].firstSeenAt,'first');});
console.log(`All ${count} webpage adapter checks passed (fixtures; not an end-to-end login test).`);
