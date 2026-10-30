// Optional link to the home PC (JARVIS phone gateway over Tailscale). Used for files both ways and,
// when it is known to be on, for transcription. Everything else works without it.
import * as store from './store.js';

const base = () => store.get('pcUrl').replace(/\/+$/, '');
export const configured = () => /^https:\/\/[a-z0-9.-]+$/i.test(base()) && !!store.get('pcToken');

async function call(path, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base() + path, {
      ...opts, cache: 'no-store', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + store.get('pcToken'), ...(opts.headers || {}) },
    });
    if (r.status === 401) { throw new Error('компьютер не узнал телефон: подключите заново'); }
    return r;
  } finally { clearTimeout(timer); }
}

let alive = false, checkedAt = 0;
export async function reachable(force = false) {
  if (!configured()) { return false; }
  if (!force && Date.now() - checkedAt < 30000) { return alive; }
  checkedAt = Date.now();
  try { alive = (await call('/api/summary', {}, 4000)).ok; } catch (e) { alive = false; }
  return alive;
}
// Without waiting: what is known now (a fresh check runs in the background). For the voice path,
// where an offline PC must not add its 4 s timeout to every question.
export function knownAlive() {
  if (!configured()) { return false; }
  if (Date.now() - checkedAt >= 30000) { reachable().catch(() => {}); }
  return alive;
}

export async function pair(url, code) {
  const clean = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(clean)) { throw new Error('адрес вида https://имя-пк.сеть.ts.net'); }
  if (!/^\d{6}$/.test(code.trim())) { throw new Error('нужен 6-значный код с компьютера'); }
  const r = await fetch(clean + '/api/pair', {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim(), name: 'JARVIS Mobile' }),
  });
  const data = await r.json();
  if (!r.ok) { throw new Error(data.error || 'HTTP ' + r.status); }
  store.set('pcUrl', clean);
  store.set('pcToken', data.token);
  checkedAt = 0;
  return true;
}

async function jsonPost(path, body, timeoutMs) {
  const r = await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
  const data = await r.json();
  if (!r.ok) { throw new Error(data.error || 'HTTP ' + r.status); }
  return data;
}

// The PC understands its own allowlisted phrases ("найди на компьютере …", "отправь файл 2").
export const say = (text) => jsonPost('/api/say', { text }, 70000);  // the PC itself waits up to 60 s for an answer
export const find = (query) => say('найди на компьютере ' + query);
export const send = (index) => say('отправь файл ' + index);

// Only the owner's explicit TV form submission calls this endpoint.
export async function castVideo(value) {
  if (!configured()) { throw new Error('сначала подключите компьютер в настройках JARVIS'); }
  const url = String(value || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch (e) { throw new Error('вставьте полную ссылку на видео (https://…)'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2000) {
    throw new Error('нужна ссылка HTTP/HTTPS без пароля, длиной до 2000 символов');
  }
  try {
    const data = await jsonPost('/api/tv/play', { url }, 30000);
    if (data.status !== 'pending' || !data.id) { throw new Error(data.error || 'компьютер не подтвердил добавление команды в очередь'); }
    const pending = { ...data, speech: 'Запрос в очереди ПК. Воспроизведение ещё не подтверждено; проверьте телевизор.' };
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        const response = await call('/api/queue', {}, 4000);
        if (!response.ok) { return pending; }
        const queue = await response.json();
        const item = (queue.items || []).find((entry) => entry.id === data.id);
        if (item && ['done', 'failed', 'dismissed'].includes(item.status)) {
          return { ...item, speech: item.speech || (item.status === 'done'
            ? 'Команда передана телевизору. Проверьте воспроизведение на экране ТВ.' : 'Запрос не выполнен. Проверьте подключение телевизора на ПК.') };
        }
      } catch (e) {
        // The POST already queued the request: a lost connection must never send it twice.
        return { ...pending, speech: 'Запрос добавлен в очередь, но связь с ПК потеряна. Проверьте телевизор перед повторной отправкой.' };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return pending;
  } catch (e) {
    if (e.name === 'AbortError') { throw new Error('компьютер не ответил вовремя; проверьте ПК и Tailscale'); }
    if (e instanceof TypeError) { throw new Error('нет связи с компьютером; включите ПК и Tailscale'); }
    throw e;
  }
}

export async function download(link) {
  if (!/^\/api\/file\/[A-Za-z0-9_-]{20,40}$/.test(link)) { throw new Error('bad link'); }
  const r = await call(link, {}, 120000);
  if (!r.ok) { throw new Error(r.status === 410 ? 'ссылка уже использована или истекла' : 'HTTP ' + r.status); }
  const cd = r.headers.get('Content-Disposition') || '';
  const name = decodeURIComponent((cd.match(/filename\*=UTF-8''(.+)$/) || [])[1] || 'file');
  return { name, blob: await r.blob() };
}

export async function upload(file) {
  const r = await call('/api/upload', {
    method: 'POST', body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
  }, 300000);
  const data = await r.json();
  if (!r.ok) { throw new Error(data.error || 'HTTP ' + r.status); }
  return data;
}

// JARVIS's voice made on the PC (Piper with the robot-3 effect, no daily quota): used when Gemini's free
// voice quota is used up, instead of the phone's own quiet voice. Returns WAV bytes.
export async function speech(text) {
  const r = await call('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 1000), local: true }) }, 60000);  // Gemini already refused here
  if (!r.ok) { throw new Error('голос компьютера: HTTP ' + r.status); }
  return new Uint8Array(await r.arrayBuffer());
}

// A short error label for the PC log (%LOCALAPPDATA%\JARVIS\gateway.log), so failures on the phone can be
// diagnosed. Fire-and-forget; nothing when the PC is not paired.
export function report(event) {
  if (!configured()) { return; }
  call('/api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: ('mobile ' + event).slice(0, 120) }) }, 5000).catch(() => {});
}

// Web Push from the PC (reminders, briefings): the PC's public VAPID key, then this phone's subscription.
export async function pushKey() {
  const r = await call('/api/push/key', {}, 10000);
  const data = await r.json();
  if (!r.ok || !data.key) { throw new Error(data.error || 'HTTP ' + r.status); }
  return data.key;
}
export const pushSubscribe = (subscription) => jsonPost('/api/push/subscribe', { subscription }, 10000);

export async function listen(blob) {
  const r = await call('/api/listen', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'audio/mp4' } }, 60000);
  const data = await r.json();
  if (!r.ok) { throw new Error(data.error || 'HTTP ' + r.status); }
  return data.text || '';
}
