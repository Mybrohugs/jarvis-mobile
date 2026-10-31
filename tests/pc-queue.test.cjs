const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function client(body, http = 200) {
  const calls = [];
  const context = { AbortController, setTimeout, clearTimeout, URL,
    store: { get: key => ({ pcUrl: 'https://pc.example.ts.net', pcToken: 'fake-owner-token' })[key] || '' },
    fetch: async (url, options) => { calls.push({url, options}); return { ok: http < 400, status: http, json: async () => body }; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('pc.js', 'utf8').replace(/^import .*;$/m, '').replace(/export /g, ''), context);
  return { read: context.queueItem, calls };
}
test('queue lookup authenticates read-only and returns only requested job', async () => {
  const c = client({ items: [{id:'aaaaaaaaaaaa',status:'done'}, {id:'bbbbbbbbbbbb',status:'pending'}] });
  assert.equal((await c.read('bbbbbbbbbbbb')).status, 'pending');
  assert.equal(c.calls[0].url, 'https://pc.example.ts.net/api/queue');
  assert.equal(c.calls[0].options.headers.Authorization, 'Bearer fake-owner-token');
  assert.notEqual(c.calls[0].options.method, 'POST');
  assert.equal(c.calls[0].options.cache, 'no-store');
});
test('invalid queue IDs never fetch and malformed/auth responses are refused', async () => {
  const c = client({ items: [] });
  await assert.rejects(c.read('../other'));
  assert.equal(c.calls.length, 0);
  assert.equal(await c.read('aaaaaaaaaaaa'), null);
  await assert.rejects(client({}).read('aaaaaaaaaaaa'), /некорректную очередь/);
  await assert.rejects(client({}, 401).read('aaaaaaaaaaaa'), /подключите заново/);
});
