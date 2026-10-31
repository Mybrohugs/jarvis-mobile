const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function page(pairError) {
  const ids = ['tvdev','tvpair','tvpanel','tvpairbutton','tvcode','tvmsg','tvpairstate','tvurl','tvsend','tvform'];
  const elements = Object.fromEntries(ids.map(id => [id, {}]));
  const calls = [];
  const context = { document: { getElementById: id => elements[id] },
    window: { location: { protocol:'https:',hostname:'pc.test.ts.net',port:'8443',origin:'https://pc.test.ts.net:8443',search:'' } },
    configured: () => false, sharedVideo: () => '', playVideo: async () => ({}),
    pair: async (url, code) => { calls.push({url,code}); if (pairError) throw new Error(pairError); } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('tv_ui.js','utf8').replace(/^import .*;$/gm,''),context);
  return { elements, calls };
}
test('DEV pairing works independently of cloud modules and uses this private origin', async () => {
  const c = page();
  assert.equal(c.elements.tvdev.hidden,false);
  assert.equal(c.elements.tvpair.hidden,false);
  c.elements.tvcode.value = '123456';
  await c.elements.tvpairbutton.onclick();
  assert.deepEqual(c.calls,[{url:'https://pc.test.ts.net:8443',code:'123456'}]);
  assert.equal(c.elements.tvpair.hidden,true);
  assert.equal(c.elements.tvcode.value,'');
  assert.equal(c.elements.tvpairbutton.disabled,false);
});
test('expired DEV code is shown and can be corrected without sending video', async () => {
  const c = page('Код истёк');
  c.elements.tvcode.value = '123456';
  await c.elements.tvpairbutton.onclick();
  assert.equal(c.elements.tvpairstate.textContent,'Код истёк');
  assert.equal(c.elements.tvpairbutton.disabled,false);
  assert.equal(c.elements.tvpair.hidden,false);
});
