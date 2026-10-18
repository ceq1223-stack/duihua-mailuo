const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const dir='outputs/topic-atlas-extension/';
let passed=0;const pass=s=>{passed++;console.log('PASS',s);};
async function run(){
 let h,reads=0,requests=0,sends=0,clicked=false,permission='granted';
 const context=vm.createContext({AtlasLibrary:{handle:async()=>{reads++;return h;}}});
 vm.runInContext(fs.readFileSync(dir+'library-access.js','utf8'),context);
 const access=vm.runInContext('AtlasLibraryAccess',context);
 assert.equal(await access.prepare(),false);
 await assert.rejects(access.authorize(async()=>sends++),/尚未就绪/);assert.equal(sends,0);pass('A missing handle never opens a picker or silently sends a reconnect');
 h={requestPermission(options){assert(clicked);assert.equal(options.mode,'readwrite');requests++;return Promise.resolve(permission);}};
 assert.equal(await access.prepare(),true);const before=reads;
 clicked=true;const promise=access.authorize(async message=>{sends++;assert.equal(message.type,'library-reconnect');return {ok:true,count:2};});
 assert.equal(requests,1);assert.equal(reads,before);clicked=false;assert.equal((await promise).count,2);pass('Permission request runs immediately in the user click before any storage or runtime await');
 permission='denied';clicked=true;await assert.rejects(access.authorize(async()=>sends++),/未获得/);clicked=false;assert.equal(sends,1);pass('A denied browser grant does not sync, fake success, or start paid tasks');
 permission='granted';clicked=true;await assert.rejects(access.authorize(async()=>{throw new Error('disk full');}),/disk full/);clicked=false;pass('A granted permission cannot hide failure of the actual folder synchronization');
 const msg='等待文件夹授权；新内容暂存浏览器。';
 let rows=access.summary({connected:true,granted:false,permission:'prompt',error:msg},msg);assert.equal(rows.length,1);assert(rows[0].includes('本次文件夹授权已结束'));pass('Expired temporary permission appears once even when the queue stores the same warning');
 rows=access.summary({connected:true,granted:false,permission:'denied',error:msg},'Other task failure');assert.equal(rows.length,2);assert(rows[0].includes('被拒绝'));assert.equal(rows[1],'Other task failure');pass('Explicit denial remains distinct and unrelated task warnings remain visible');
 rows=access.summary({connected:true,granted:true,name:'Topic Atlas',error:'disk full'},'disk full');assert.deepEqual(Array.from(rows),['disk full']);pass('Genuine disk failures are retained and deduplicated');
 h={requestPermission(){throw new Error('replacement handle');}};await access.prepare();await assert.rejects(access.authorize(async()=>{}),/replacement handle/);pass('A later folder selection replaces the UI handle instead of reauthorizing an old folder');
 const panel=fs.readFileSync(dir+'panel.html','utf8'),settings=fs.readFileSync(dir+'settings.html','utf8');assert(!panel.includes('id="restoreFolderAccess"'));assert(settings.includes('id="reauthorize"'));assert(settings.indexOf('src="library.js"')<settings.indexOf('src="settings.js"'));pass('Folder recovery is available in unified settings and dependencies load before its handler');
 console.log(`All ${passed} library access checks passed.`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
