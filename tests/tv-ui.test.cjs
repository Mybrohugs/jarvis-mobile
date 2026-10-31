const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('shared page never sends automatically; form submits once and reports result', async () => {
  const ids = ['tvurl', 'tvpanel', 'tvmsg', 'tvform', 'tvsend'];
  const elements = Object.fromEntries(ids.map(id => [id, {}]));
  let calls = 0, finish;
  const context = { window: { location: { search: '?url=shared' } },
    sharedVideo: () => 'https://example.com/v', $: id => elements[id],
    playVideo: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  vm.createContext(context);
  const source = fs.readFileSync('tv_ui.js', 'utf8');
  const start = source.indexOf('// Sharing fills the form;');
  vm.runInContext(source.slice(start, source.length), context);
  assert.equal(calls, 0);
  assert.equal(elements.tvurl.value, 'https://example.com/v');
  assert.equal(elements.tvpanel.open, true);
  const first = elements.tvform.onsubmit({ preventDefault() {} });
  await elements.tvform.onsubmit({ preventDefault() {} });
  assert.equal(calls, 1);
  finish({ speech: 'В очереди ПК' });
  await first;
  assert.equal(elements.tvmsg.textContent, 'В очереди ПК');
  assert.equal(elements.tvsend.disabled, false);
});
