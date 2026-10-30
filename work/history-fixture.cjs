// Deterministic routing fixture. Graph-call assertions remain separate from
// history-call assertions; tests can inspect both actual request streams.
function selection(input) {
 return {action:'select_history',topicIds:input.topicCatalog.map(t=>t.id),roundIds:[],uncertain:false,reason:'Fixture: inspect the supplied directory.'};
}
const response=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
const briefs=input=>({action:'topic_briefs',topics:input.topics.map(t=>({id:t.id,brief:'讨论'+t.name+'的范围与相关问题。'}))});
function oversizeHistory(h,key){for(const topic of h.state['conversation:'+key].aiResults.current.result.topics)topic.summary='历史详情。'.repeat(390);}
module.exports={selection,response,briefs,oversizeHistory};
