import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sharedVideo } from '../tv_share.js';

function client(responses, paired = true) {
  const calls = [];
  let time = 0;
  const context = {
    URL, AbortController, TypeError, Date: { now: () => time },
    store: { get: (key) => ({ pcUrl: paired ? 'https://pc.example.ts.net' : '', pcToken: paired ? 'owner-token' : '' })[key] || '' },
    setTimeout: (fn, ms) => { if (ms === 1500) { time += ms; queueMicrotask(fn); } return 1; },
    clearTimeout: () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      const reply = responses.length > 1 ? responses.shift() : responses[0];
      if (reply instanceof Error) { throw reply; }
      return { ok: reply.http < 400, status: reply.http, json: async () => reply.body };
    },
  };
  vm.createContext(context);
  const source = fs.readFileSync(new URL('../pc.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/m, '').replace(/\bexport /g, '');
  vm.runInContext(source, context);
  return { cast: context.castVideo, calls };
}
const queued = { http: 202, body: { status: 'pending', id: 'job-1' } };

test('TV request authenticates, queues only once and waits for its own result', async () => {
  const c = client([queued,
    { http: 200, body: { items: [{ id: 'other', status: 'done' }, { id: 'job-1', status: 'pending' }] } },
    { http: 200, body: { items: [{ id: 'job-1', status: 'done', speech: 'Передано на ТВ' }] } },
  ]);
  const result = await c.cast(' https://youtu.be/test ');
  assert.equal(result.status, 'done');
  assert.equal(result.speech, 'Передано на ТВ');
  assert.equal(c.calls[0].url, 'https://pc.example.ts.net/api/tv/play');
  assert.equal(c.calls[0].options.headers.Authorization, 'Bearer owner-token');
  assert.deepEqual(JSON.parse(c.calls[0].options.body), { url: 'https://youtu.be/test' });
  assert.equal(c.calls.filter((x) => x.options.method === 'POST').length, 1);
});

test('unpaired phone and invalid links make no network request', async () => {
  const c = client([], false);
  await assert.rejects(c.cast('https://youtu.be/test'), /подключите компьютер/);
  assert.equal(c.calls.length, 0);
  const paired = client([]);
  for (const url of ['javascript:alert(1)', 'https://name:password@example.com/video.mp4', 'not-a-link', 'https://example.com/' + 'a'.repeat(2000)]) {
    await assert.rejects(paired.cast(url));
  }
  assert.equal(paired.calls.length, 0);
});

test('backend refusal and expired pairing are shown without polling', async () => {
  const c = client([{ http: 400, body: { error: 'Неподдерживаемая страница' } }]);
  await assert.rejects(c.cast('https://example.com/watch'), /Неподдерживаемая/);
  assert.equal(c.calls.length, 1);
  const expired = client([{ http: 401, body: {} }]);
  await assert.rejects(expired.cast('https://youtu.be/test'), /подключите заново/);
});

test('offline and timed-out computers give actionable connection errors', async () => {
  const timeout = new Error('aborted'); timeout.name = 'AbortError';
  for (const error of [new TypeError('fetch failed'), timeout]) {
    const c = client([error]);
    await assert.rejects(c.cast('https://youtu.be/test'), /Tailscale/);
    assert.equal(c.calls.length, 1);
  }
});

test('pending timeout and lost queue connection never claim playback or repeat POST', async () => {
  for (const response of [{ http: 200, body: { items: [] } }, new TypeError('network')]) {
    const c = client([queued, response]);
    const result = await c.cast('https://youtu.be/test');
    assert.equal(result.status, 'pending');
    assert.match(result.speech, /очеред/);
    assert.equal(c.calls.filter((x) => x.options.method === 'POST').length, 1);
  }
});

test('failed and dismissed queue results stay failures', async () => {
  for (const status of ['failed', 'dismissed']) {
    const c = client([queued, { http: 200, body: { items: [{ id: 'job-1', status, speech: 'ТВ недоступен' }] } }]);
    const result = await c.cast('https://youtu.be/test');
    assert.equal(result.status, status);
    assert.equal(result.speech, 'ТВ недоступен');
  }
});

test('shared URLs only produce prefill text, preferring explicit URL field', () => {
  assert.equal(sharedVideo('?url=https%3A%2F%2Fyoutu.be%2Fabc&text=other'), 'https://youtu.be/abc');
  assert.equal(sharedVideo('?text=' + encodeURIComponent('Видео: https://youtu.be/xyz')), 'https://youtu.be/xyz');
  assert.equal(sharedVideo('?text=no-link'), '');
  assert.equal(sharedVideo('?url=javascript%3Aalert(1)'), '');
  assert.equal(sharedVideo('?url=' + encodeURIComponent('https://user:password@example.com/video.mp4')), '');
});

test('opening a shared link does not cast; only form submission does', async () => {
  const elements = Object.fromEntries(['tvurl', 'tvpanel', 'tvmsg', 'tvform', 'tvsend'].map((id) => [id, {}]));
  const requests = [];
  const context = {
    sharedVideo, window: { location: { search: '?url=https%3A%2F%2Fyoutu.be%2Fabc' } },
    $: (id) => elements[id], pc: { castVideo: async (url) => { requests.push(url); return { status: 'pending', speech: 'В очереди' }; } },
  };
  const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const start = source.indexOf('const shared = sharedVideo(');
  vm.createContext(context);
  vm.runInContext(source.slice(start, source.indexOf('// ---------- push-to-talk', start)), context);
  assert.equal(elements.tvurl.value, 'https://youtu.be/abc');
  assert.equal(elements.tvpanel.open, true);
  assert.equal(requests.length, 0);
  await elements.tvform.onsubmit({ preventDefault() {} });
  assert.deepEqual(requests, ['https://youtu.be/abc']);
  assert.equal(elements.tvmsg.textContent, 'В очереди');
  assert.equal(elements.tvsend.disabled, false);
});
