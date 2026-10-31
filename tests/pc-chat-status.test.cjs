const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function client(payload,status=200){
 let calls=0;const context=vm.createContext({store:{get:key=>key==='pcUrl'?'https://pc.test.ts.net/jarvis-dev':'fake-device'},
 AbortController,setTimeout,clearTimeout,Number,Error,Date,fetch:async()=>{calls++;return {ok:status>=200&&status<300,status,json:async()=>payload};}});
 const source=fs.readFileSync(path.join(__dirname,'../pc.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');vm.runInContext(source,context);
 return {context,count:()=>calls};
}
test('Each ChatGPT failure has a distinct phone label',()=>{
 const {context:c}=client({});assert.equal(c.chatLabel({connected:true}),'ChatGPT');
 for(const [code,label] of Object.entries({auth_required:'нужен вход',network:'нет интернета',rate_limited:'лимит ChatGPT',access_denied:'нет доступа',busy:'занят'}))assert.equal(c.chatLabel({connected:false,code}),label);
});
test('Transient chat errors preserve metadata and do not submit again',async()=>{
 const {context:c,count}=client({error:'Лимит ChatGPT',code:'rate_limited',needs_auth:false,retryable:true,retry_after:30},429);
 await assert.rejects(vm.runInContext('chatTurn([{role:"user",content:"hi"}],"")',c),e=>e.code==='rate_limited'&&!e.needsAuth&&e.retryAfter===30);
 assert.equal(count(),1);
});
test('Status preserves distinction between network failure and revoked session',async()=>{
 const network=client({connected:false,error:'Нет интернета',code:'network',needs_auth:false});
 const status=await network.context.chatStatus();assert.equal(status.code,'network');assert.equal(status.needs_auth,false);
 const auth=client({error:'Повторный вход',code:'auth_required',needs_auth:true},503);
 await assert.rejects(auth.context.chatStatus(),e=>e.code==='auth_required'&&e.needsAuth);
});
test('Mobile worker activation does not erase another app cache',async()=>{
 const handlers={};let pending;const deleted=[];
 const c=vm.createContext({self:{addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{}}},
 caches:{keys:async()=>['jarvis-mobile-chatgpt-dev-v23','jarvis-pwa-production','unrelated'],delete:async key=>deleted.push(key)},Promise});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),c);handlers.activate({waitUntil:p=>pending=p});await pending;
 assert.deepEqual(deleted,['jarvis-mobile-chatgpt-dev-v23']);
});
