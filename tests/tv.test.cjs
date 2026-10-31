const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function client(reply, paired = true, updates = []) {
  const calls = [];
  let time = 0;
  const ctx = { URL, URLSearchParams, Date: { now: () => time },
    setTimeout: (fn, ms) => { time += ms; queueMicrotask(fn); },
    queueItem: async () => { const item = updates.shift(); if (item instanceof Error) throw item; return item || null; },
    configured: () => paired,
    say: async (text) => { calls.push(text); if (reply instanceof Error) throw reply; return reply; } };
  vm.createContext(ctx);
  const source = fs.readFileSync('tv.js', 'utf8').replace(/^import .*;$/m, '').replace(/export /g, '');
  vm.runInContext(source, ctx);
  return { ...ctx, calls };
}
test('uses existing authenticated PC command exactly once', async () => {
  const c = client({ id: 'job', status: 'done', speech: 'Передано' });
  const out = await c.playVideo(' https://example.com/video.mp4 ');
  assert.deepEqual(c.calls, ['на телевизор https://example.com/video.mp4']);
  assert.equal(out.speech, 'Передано');
});
test('pending and failures never claim playback', async () => {
  const c = client({ id: 'job', queued: true });
  assert.match((await c.playVideo('https://example.com/v')).speech, /ещё не подтверждено/);
  for (const status of ['failed', 'dismissed']) {
    await assert.rejects(client({ id: 'job', status, speech: 'ТВ недоступен' }).playVideo('https://example.com/v'), /ТВ недоступен/);
  }
});
test('invalid links and unpaired phone never submit', async () => {
  const c = client({});
  for (const url of ['javascript:alert(1)', 'https://u:p@example.com/x', 'bad', 'https://example.com/' + 'a'.repeat(500)]) {
    await assert.rejects(c.playVideo(url));
  }
  assert.equal(c.calls.length, 0);
  const unpaired = client({}, false);
  await assert.rejects(unpaired.playVideo('https://example.com/v'), /подключите/);
  assert.equal(unpaired.calls.length, 0);
});
test('sharing only prefills; network errors never retry', async () => {
  const c = client(new Error('Нет связи'));
  assert.equal(c.sharedVideo('?text=' + encodeURIComponent('Видео https://example.com/v')), 'https://example.com/v');
  assert.equal(c.calls.length, 0);
  await assert.rejects(c.playVideo('https://example.com/v'), /перед повторной/);
  assert.equal(c.calls.length, 1);
});

test('pending request waits for its own result without sending twice', async () => {
  const c = client({ id: 'job', queued: true }, true,
    [null, { id: 'job', status: 'done', speech: 'На телевизоре воспроизводится выбранное видео.' }]);
  assert.match((await c.playVideo('https://example.com/v')).speech, /воспроизводится/);
  assert.equal(c.calls.length, 1);
});
test('lost queue, terminal failure and unknown status never claim playback or retry', async () => {
  const offline = client({ id: 'job', queued: true }, true, [new Error('offline')]);
  assert.match((await offline.playVideo('https://example.com/v')).speech, /связь.*потеряна/);
  assert.equal(offline.calls.length, 1);
  const failed = client({ id: 'job', queued: true }, true, [{ id: 'job', status: 'failed', speech: 'Отказ ТВ' }]);
  await assert.rejects(failed.playVideo('https://example.com/v'), /Отказ ТВ/);
  assert.equal(failed.calls.length, 1);
  await assert.rejects(client({ id: 'job', status: 'mystery' }).playVideo('https://example.com/v'), /неизвестный/);
});

test('duplicated scheme never enters the PC queue', async()=>{
 const c=client({});await assert.rejects(c.playVideo('https://https://example.com/v'),/дважды/);assert.equal(c.calls.length,0);
});
