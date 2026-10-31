const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function brain(pc,google={}) {
 const source=fs.readFileSync(path.join(__dirname,'../brain.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 const context=vm.createContext({pc,google,store:{get:()=> 'Москва',json:(_,d)=>d},Date,Intl,JSON,Error});
 vm.runInContext(source,context);return context;
}
test('ChatGPT text uses authenticated PC and retains conversation',async()=>{
 let calls=[];const c=brain({configured:()=>true,chatTurn:async(input)=>{calls.push(JSON.parse(JSON.stringify(input)));return {text:'Ответ',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Ответ'}]}]};}});
 assert.equal(await c.ask('Привет'),'Ответ');await c.ask('Продолжи');assert.equal(calls[1].length,3);
});
test('Calendar tools roundtrip as Responses function outputs',async()=>{
 let round=0,events=0;const c=brain({configured:()=>true,chatTurn:async(input)=>{
 if(round++===0)return {output:[{type:'function_call',namespace:'phone',name:'calendar_events',call_id:'abc',arguments:'{"from":"2026-10-31","to":"2026-11-01"}'}]};
 assert.equal(input.at(-1).type,'function_call_output');assert.equal(input.at(-1).call_id,'abc');return {text:'Событий нет',output:[]};
 }},{events:async()=>{events++;return [];}});assert.equal(await c.ask('Что в календаре?'),'Событий нет');assert.equal(events,1);
});
test('Unpaired phone never calls provider and failures reset partial history',async()=>{
 let calls=0;const pc={configured:()=>false,chatTurn:async()=>{calls++;throw new Error('Нет связи');}};const c=brain(pc);
 await assert.rejects(c.ask('hi'),/Подключите/);assert.equal(calls,0);pc.configured=()=>true;
 await assert.rejects(c.ask('hi'),/Нет связи/);pc.chatTurn=async(input)=>{assert.equal(input.length,1);return {text:'OK',output:[]};};assert.equal(await c.ask('again'),'OK');
});
test('UI no longer requests provider keys; worker never caches API responses',()=>{
 const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 for(const name of ['index.html','main.js','brain.js','store.js'])assert.doesNotMatch(read(name),/claudeKey|claudekey|api\.anthropic|@anthropic/);
 assert.doesNotMatch(read('voice.js'),/generativelanguage|geminiKey|geminiStream/);
 assert.match(read('sw.js'),/url\.pathname\.includes\('\/api\/'\)/);
});
