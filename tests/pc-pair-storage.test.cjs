const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function client(storage, writable = true, token = 't'.repeat(43)) {
  let requests = 0;
  const context = { URL, AbortController, setTimeout, clearTimeout,
    store: { get: key => storage.get(key) || '', set: (key,value) => { if (writable) storage.set(key,value); } },
    fetch: async () => { requests++; return {ok:true,json:async()=>({token})}; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('pc.js','utf8').replace(/^import .*;$/m,'').replace(/export /g,''),context);
  return { pair: context.pair, configured: vm.runInContext('configured',context), requests: () => requests };
}
test('paired phone remains configured in a fresh page context without a new code',async()=>{
  const storage = new Map();
  const first = client(storage);
  await first.pair('https://pc.test.ts.net:8443','123456');
  assert.equal(first.configured(),true);
  const reloaded = client(storage);
  assert.equal(reloaded.configured(),true);
  assert.equal(reloaded.requests(),0);
});
test('failed browser persistence never reports successful pairing',async()=>{
  const c = client(new Map(),false);
  await assert.rejects(c.pair('https://pc.test.ts.net:8443','123456'),/не сохранил подключение/);
  assert.equal(c.configured(),false);
  assert.equal(c.requests(),1);
});
test('missing token never creates a stored pairing',async()=>{
  const storage = new Map();
  await assert.rejects(client(storage,true,null).pair('https://pc.test.ts.net:8443','123456'),/не вернул ключ/);
  assert.equal(storage.size,0);
});

test('standard HTTPS DEV path is stored and remains configured after reload',async()=>{
  const storage=new Map();
  await client(storage).pair('https://pc.test.ts.net/jarvis-dev','123456');
  assert.equal(storage.get('pcUrl'),'https://pc.test.ts.net/jarvis-dev');
  assert.equal(client(storage).configured(),true);
});
