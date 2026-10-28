const AI=require('../outputs/topic-atlas-extension/ai.js');
module.exports=config=>{
 const p=AI.config(config);
 return {...config,capability:config.capability??{baseUrl:p.baseUrl,model:p.model,contextWindow:1000000,maxOutput:32768,source:'Synthetic test capability; not a real model limit',method:'manual',confirmed:true,checkedAt:'2026-10-22T00:00:00Z'}};
};
