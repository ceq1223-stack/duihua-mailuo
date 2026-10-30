const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=path.join(__dirname,'src'),out=path.join(__dirname,'dist'),read=name=>fs.readFileSync(path.join(src,name),'utf8');
let html=read('index.html').replace('<link rel="stylesheet" href="style.css">','<style>'+read('style.css')+'\n'+read('graph.css')+'\n'+read('overrides.css')+'</style>');
for(const name of ['graph-view.js','demo-data.js','frontier-view.js','app.js']){const code=read(name);new vm.Script(code,{filename:name});html=html.replace('<script src="'+name+'"></script>','<script>\n'+code.replace(/<\/script/gi,'<\\/script')+'\n</script>');}
if(/(?:src|href)="(?:https?:|\/\/)/i.test(html))throw new Error('Unexpected remote dependency');
if(/fetch\s*\(|XMLHttpRequest|api[_-]?key|sk-[A-Za-z0-9]{10}/i.test(html))throw new Error('Unexpected network API or credential field');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'index.html'),html,'utf8');console.log('Standalone demo built: '+path.join(out,'index.html'));
