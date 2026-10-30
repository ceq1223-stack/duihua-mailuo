/* Rewritten illustrative content, never a transcript or a live AI result. */
(() => {
const topics=[
 {id:'problem',name:'对话混乱问题',brief:'长对话不断分叉，已有想法难以回看。',summary:'这段讨论从长对话的混乱感开始：问题会展开成多个方向，后续又回到旧主题，单纯按时间往下翻很难重建思路。产品希望同时保留时间顺序与知识主题，让“当时聊到哪”和“后来怎样发展”都能找到。'},
 {id:'sidebar',name:'实时侧边栏设想',brief:'在聊天旁边，持续显示讨论的脉络。',summary:'把整理结果放在聊天旁边，减少在不同页面之间来回切换。时间线保留每轮标题，关系图呈现主题之间的展开与回归。后续讨论进一步明确：主界面要安静，只保留两个主要视图。'},
 {id:'architecture',name:'主题中心架构',brief:'用主题组织内容，用轮次保留讨论依据。',summary:'主题是 AI 归纳出的知识单元，标题是每轮对话的索引。一个主题可以关联不相邻的多轮讨论。用户先点主题了解摘要，再通过 R 编号和标题回到时间线，避免把关系图做成逐条问答的复制。'},
 {id:'models',name:'双层模型取舍',brief:'区分网页采集与模型归纳的职责。',summary:'讨论把获取对话和理解对话拆成两项工作：程序负责读取消息及结构，用户选择的模型负责归纳主题与关系。演示只展示预先准备的结果，避免让访客配置模型或等待实时生成。'},
 {id:'research',name:'竞品调查',brief:'借鉴已有工具，确认自己的需求边界。',summary:'比较已有对话整理工具，重点关注时间线导航、主题组织、分支展示和原消息定位。相似界面可以提供启发，但是否适合仍取决于能否帮助用户回顾持续变化的讨论。'},
 {id:'turnmap',name:'TurnMap 评估',brief:'把相近产品作为体验与需求的参照。',summary:'TurnMap 曾作为接近初始想法的产品被讨论。评估的重点是体验与需求是否契合；“看起来相近”不代表已经完成兼容性、功能完整性或稳定性的验证。'},
 {id:'deployment',name:'部署与体验入口',brief:'让别人先体验，再决定如何分享。',summary:'从部署现有工具的讨论，延伸到为自己的产品准备展示入口。独立只读演示可以先说明产品价值；真实采集、API 配置与本地资料库属于插件使用流程，不需要放进首次体验。'}
];
const rows=[
 ['problem','发现长对话里的混乱','一个问题越聊越散，隔一段时间就找不到前面的思路。','可以同时保留时间顺序和主题关系，让分支与回归都有迹可循。'],
 ['sidebar','设想一个聊天侧边栏','我想边聊天边看到主题，不用每次重新整理。','可以考虑三个方向：先尝试实时主题侧边栏，用主题连接不同轮次；也可以建立跨会话知识库，把相近主题集中起来；还可以生成研究报告，汇总讨论中的结论和分歧。我们可以先沿侧边栏方向，讨论主题怎么组织。'],
 ['architecture','改为围绕主题组织内容','关系图应该以知识主题为中心，而不是一问一答一个节点。','主题可以关联多轮讨论；用每轮标题和轮次编号回到上下文。还可以允许手动合并相近主题，或者为主题增加版本对比；这次先讨论主题与轮次的对应关系。'],
 ['models','讨论采集与模型归纳的分工','读取网页内容和总结主题，需要由同一层来完成吗？','可以区分程序采集和模型归纳，分别处理来源与理解问题。'],
 ['research','调查相近的对话整理工具','先看看已有工具怎么做时间线和关系导航。','比较它们如何组织主题、展示分支，以及帮助用户定位讨论。另有两个方向：建立竞品能力对照表，或者招募用户做一次回顾任务测试。先沿现有产品体验继续。'],
 ['turnmap','评估 TurnMap 是否接近想法','TurnMap 的体验看起来与我的想法接近。','可以把它作为需求参照，再核对自己最需要的主题组织能力。'],
 ['deployment','尝试部署并准备体验入口','先把相关工具部署下来，看看实际使用过程。','部署之后还需要通过具体对话验证体验，不能仅凭界面判断效果。'],
 ['architecture','回到主题中心，明确阅读顺序','回到前面的架构：点开主题后，应该先看到什么？','先看主题详细摘要，再看 R 编号与本轮标题；点击标题进入时间线。'],
 ['sidebar','收敛侧边栏的主界面','侧栏的文字有点多，我认为两个主视图就够了。','保留时间线列表和关系图，将设置和任务详情放到辅助页面。'],
 ['models','补充自选 API 与提示词的设想','希望后续能选择模型，并调整归纳提示词。','这些配置属于实际插件；首次演示可以直接使用预置结果。另外，切换模型和提示词后，怎样比较归纳效果？这个问题先留着，尚未继续讨论。'],
 ['turnmap','把竞品经验落实到自己的体验','参考之后，还是需要一个能体现自己思路的展示。','把主题、分支、回归和时间线跳转连起来，比单独展示功能清单更直观。'],
 ['deployment','确认展示页的分享方式','别人是否一定要安装插件才能看到效果？','不用。只读示例可以独立打开；需要发链接时，再部署成静态网页。之后还可以提供可编辑的示例模板，或者录制一段产品演示视频。这两条先留着。'],
 ['architecture','用标题把主题与时间线接起来','最终还是要能从主题回到对应的讨论。','每条标题关联稳定的轮次标识，点击后展开并高亮对应内容。']
];
const rounds=rows.map(([topic,title,user,assistant],i)=>({id:'r'+(i+1),number:i+1,topic,title,user,assistant}));
const edges=[['problem','sidebar','flow',2],['sidebar','architecture','flow',3],['architecture','models','branch',4],['sidebar','research','branch',5],['research','turnmap','flow',6],['turnmap','deployment','flow',7],['deployment','architecture','return',8],['architecture','sidebar','return',9],['sidebar','models','return',10],['models','turnmap','return',11]];
const result={topics:topics.map(t=>({...t,roundIds:rounds.filter(r=>r.topic===t.id).map(r=>r.id)})),timeline:rounds.map(r=>({roundId:r.id,title:r.title,primaryTopicId:r.topic,secondaryTopicIds:[]})),relations:edges.map(([from,to,type,at])=>({from,to,type,atRoundId:'r'+at,label:type==='return'?'重新讨论已有主题':type==='branch'?'展开一个方向':'继续推进',reason:type==='return'?'演示此处重新讨论了前面出现过的主题。':'演示讨论从前一个方向展开到这一主题。',evidence:[]}))};
const directions=[
 {id:'live-sidebar',parentTopicId:'sidebar',title:'实时主题侧边栏',summary:'沿侧边栏方向继续讨论主题组织方式。',sourceRoundId:'r2',quote:'先尝试实时主题侧边栏，用主题连接不同轮次',initialStatus:'expanded',followRoundId:'r3'},
 {id:'cross-chat-library',kind:'unexplored',parentTopicId:'sidebar',title:'跨会话知识库',summary:'把不同对话中的相近主题集中起来，减少重复讨论。这条建议提出后，示例继续讨论了侧边栏，没有展开这条支路。',sourceRoundId:'r2',quote:'也可以建立跨会话知识库，把相近主题集中起来',initialStatus:'pending'},
 {id:'research-report',kind:'unexplored',parentTopicId:'sidebar',title:'自动生成研究报告',summary:'把讨论中的结论与分歧整理成可分享的报告。这是同一轮提出、但暂未继续的一条支路。',sourceRoundId:'r2',quote:'还可以生成研究报告，汇总讨论中的结论和分歧',initialStatus:'pending'},
 {"id": "merge-topics", "kind": "unexplored", "parentTopicId": "architecture", "title": "手动合并相近主题", "sourceRoundId": "r3", "quote": "手动合并相近主题", "summary": "相似主题是否应该由用户合并？这条方向被提出，当前讨论选择先把轮次关联做好。", "side": "left", "initialStatus": "pending"},
 {"id": "topic-versions", "kind": "unexplored", "parentTopicId": "architecture", "title": "主题版本对比", "sourceRoundId": "r3", "quote": "为主题增加版本对比", "summary": "对照前后两次归纳，查看观点如何变化。示例尚未展开具体交互。", "side": "left", "initialStatus": "pending"},
 {"id": "competitor-matrix", "kind": "unexplored", "parentTopicId": "research", "title": "竞品能力对照表", "sourceRoundId": "r5", "quote": "建立竞品能力对照表", "summary": "把采集、定位、分支和资料保存放在同一张对照表里，这条路径暂未展开。", "side": "right", "initialStatus": "pending"},
 {"id": "usability-study", "kind": "unexplored", "parentTopicId": "research", "title": "用户回顾任务测试", "sourceRoundId": "r5", "quote": "招募用户做一次回顾任务测试", "summary": "通过真实回顾任务观察用户能否找到旧结论，示例尚未讨论测试方案。", "side": "right", "initialStatus": "pending"},
 {"id": "editable-example", "kind": "unexplored", "parentTopicId": "deployment", "title": "可编辑的示例模板", "sourceRoundId": "r12", "quote": "提供可编辑的示例模板", "summary": "让访客用自己的问题替换示例，当前只完成只读展示。", "side": "right", "initialStatus": "pending"},
 {"id": "demo-video", "kind": "unexplored", "parentTopicId": "deployment", "title": "产品演示视频", "sourceRoundId": "r12", "quote": "录制一段产品演示视频", "summary": "用一段短视频展示从主题到时间线的过程，尚未讨论制作方式。", "side": "right", "initialStatus": "pending"},
 {id:'compare-summary-quality',kind:'paused',parentTopicId:'models',title:'怎样比较归纳效果？',summary:'模型和提示词已经有过讨论，但示例在这里明确留下了效果评估问题。因此这条路径标为待继续，而不是把所有末端都判成中断。',sourceRoundId:'r10',quote:'切换模型和提示词后，怎样比较归纳效果？这个问题先留着，尚未继续讨论',initialStatus:'pending'}
];
const data={topics,rounds,result,directions,label:'改写演示示例 · 非聊天原文'};globalThis.TopicAtlasDemoData=data;if(typeof module!=='undefined')module.exports=data;
})();
