// Voice in and out. In: record -> PC Whisper (if the PC answers) or Gemini transcription.
// Out: PC voice server (cached, same effect) -> Gemini TTS on the phone + the PC's robot-3 effect
// ported to JS -> the phone's own male voice.
import * as store from './store.js';
import * as pc from './pc.js';

const G = 'https://generativelanguage.googleapis.com';
// each TTS model has its own free daily quota; a 429 moves on with the same voice (as on the PC)
const TTS = [['gemini-3.8-flash-tts', true], ['gemini-3.8-flash-lite-tts', true],
  ['gemini-3.1-flash-tts-preview', false], ['gemini-2.5-flash-preview-tts', false]];
const STT = ['gemini-3.5-flash', 'gemini-flash-latest'];
const VOICE = 'Schedar';
const STYLE = 'Спокойный, вежливый и уверенный британский дворецкий-ассистент: ровный бархатный голос, лёгкая ирония, без спешки, чёткая дикция.';
const INLINE = 'Say in a calm, warm, low British butler voice, in Russian: ';

let ctx = null;
export function unlock() {  // call inside a tap: iOS allows sound only after a gesture
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { return; }
  if (!ctx) { ctx = new AC(); }
  ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, 22050);
  src.connect(ctx.destination);
  src.start(0);
  if ('speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
}
export const audio = () => ctx;

// ---------- recording ----------
let rec = null, stream = null, started = 0;
export const recording = () => !!rec;
export async function startRecording(onLevel) {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const chunks = [];
  rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  rec.ondataavailable = (e) => { if (e.data.size) { chunks.push(e.data); } };
  const done = new Promise((ok) => { rec.onstop = () => ok(new Blob(chunks, { type: (rec.mimeType || type || 'audio/mp4').split(';')[0] })); });
  rec.start();
  started = Date.now();
  if (ctx && onLevel) {
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!rec) { onLevel(0); return; }
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) { peak = Math.max(peak, Math.abs(v - 128)); }
      onLevel(Math.min(1, peak / 64));
      requestAnimationFrame(tick);
    };
    tick();
  }
  return done;
}
export function heldFor() { return Date.now() - started; }
export function stopRecording() {
  if (rec && rec.state !== 'inactive') { rec.stop(); }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  rec = null;
}

const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) { s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); } return btoa(s); };

export async function transcribe(blob) {
  if (await pc.reachable()) {
    try { return await pc.listen(blob); } catch (e) { /* fall through to Gemini */ }
  }
  const key = store.get('geminiKey');
  if (!key) { throw new Error('для голоса без компьютера нужен ключ Gemini (Настройки)'); }
  const data = b64(await blob.arrayBuffer());
  let last = null;
  for (const model of STT) {
    const r = await fetch(`${G}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: blob.type || 'audio/mp4', data } },
        { text: 'Запиши дословно, что сказано (русский язык). Только сам текст, без пояснений. Если речи нет — пустой ответ.' }] }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { return ((((d.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('').trim(); }
    last = new Error((d.error && d.error.message) || 'Gemini HTTP ' + r.status);
    if (r.status !== 429 && r.status !== 503) { break; }
  }
  throw last;
}

// ---------- speaking ----------
function rest() { try { return JSON.parse(localStorage.getItem('jarvis.mobile.ttsRest') || '{}'); } catch (e) { return {}; } }
function setRest(m) { const r = rest(); r[m] = Date.now() + 30 * 60000; try { localStorage.setItem('jarvis.mobile.ttsRest', JSON.stringify(r)); } catch (e) { /* ignore */ } }

async function geminiSpeech(text) {
  const key = store.get('geminiKey');
  if (!key) { throw new Error('no gemini key'); }
  let last = null;
  for (const [model, meta] of TTS) {
    if ((rest()[model] || 0) > Date.now()) { continue; }
    const content = meta ? { type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE }] } : { type: 'text', text: INLINE + text };
    const r = await fetch(`${G}/v1beta/interactions`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: [{ type: 'user_input', content: [content] }], response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: VOICE }] } }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      for (const step of d.steps || []) {
        for (const part of step.content || []) { if (part && part.data) { return pcmOrWav(part.data); } }
      }
      last = new Error('Gemini returned no audio');
      continue;
    }
    last = new Error((d.error && d.error.message) || 'Gemini HTTP ' + r.status);
    if (r.status === 429) { setRest(model); }
  }
  throw last;
}

export function pcmOrWav(data) {  // -> {samples: Float32Array, rate}
  const bin = atob(data), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) { u[i] = bin.charCodeAt(i); }
  let off = 0, end = u.length, rate = 24000;
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46) {
    // RIFF: read only the "data" chunk. Gemini appends other chunks after it (a C2PA signature) that
    // would otherwise play as a loud burst and squash the speech when the level is normalised.
    const dv = new DataView(u.buffer);
    let p = 12, found = false;
    while (p + 8 <= u.length) {
      const id = String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]), size = dv.getUint32(p + 4, true);
      if (id === 'fmt ') { rate = dv.getUint32(p + 12, true); }
      if (id === 'data') { off = p + 8; end = Math.min(u.length, off + size); found = true; break; }
      p += 8 + size + (size & 1);
    }
    if (!found) { throw new Error('WAV without audio'); }
  }
  const n = Math.floor((end - off) / 2), out = new Float32Array(n), dv = new DataView(u.buffer, off);
  for (let i = 0; i < n; i++) { out[i] = dv.getInt16(i * 2, true) / 32768; }
  return { samples: out, rate };
}

// robot-3 from the PC (voice_dsp.film): metal combs + 60 Hz ring, EQ, compressor, small room,
// digital double, hint of metal, normalised to 0.89.
function biquad(x, rate, type, f, gainDb = 0, q = 0.707) {
  const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f / rate, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  else { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + s); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s);
    a0 = (A + 1) - (A - 1) * cs + s; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s; }  // high shelf
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
export function robot3(x, rate) {
  const level = 1.4, amount = 1.1, n = x.length;
  let y = Float32Array.from(x);
  for (const [ms, g] of [[1.1, 0.30], [2.3, 0.22], [3.7, 0.15]]) {
    const d = Math.floor(rate * ms / 1000);
    for (const k of [1, 2]) { const gk = amount * g * Math.pow(0.55, k - 1); for (let i = d * k; i < n; i++) { y[i] += gk * x[i - d * k]; } }
  }
  for (let i = 0; i < n; i++) { y[i] = (1 - 0.18 * amount) * y[i] + 0.18 * amount * x[i] * Math.sin(2 * Math.PI * 60 * i / rate); }
  y = biquad(y, rate, 'hp', 90);
  y = biquad(y, rate, 'peak', 210, 1.0, 1.0);
  y = biquad(y, rate, 'peak', 3500, 2.0 * level, 0.9);
  y = biquad(y, rate, 'shelf', 9000, -2.0);
  const win = 160; let acc = 0; const env = new Float32Array(n);  // compressor (threshold 0.22, ratio 3)
  for (let i = 0; i < n; i++) { acc += Math.abs(y[i]) - (i >= win ? Math.abs(y[i - win]) : 0); env[i] = acc / win; }
  for (let i = 0; i < n; i++) { const over = Math.max(env[i] / 0.22, 1); y[i] /= Math.pow(over, 1 - 1 / 3); }
  const out = new Float32Array(n + Math.floor(rate * 0.05));  // 50 ms for the room echo to die out
  out.set(y);
  for (const [ms, g] of [[7, 0.22], [13, 0.16], [19, 0.12], [29, 0.08]]) {
    const d = Math.floor(rate * ms / 1000); for (let i = d; i < n + d && i < out.length; i++) { out[i] += level * g * y[i - d]; }
  }
  for (let i = 0; i < n; i++) {  // digital double: 11 ms +- 0.25 ms at 0.3 Hz
    const t = i - (11 + 0.25 * Math.sin(2 * Math.PI * 0.3 * i / rate)) * rate / 1000, j = Math.floor(t);
    if (j >= 0 && j + 1 < n) { out[i] += level * 0.14 * (y[j] + (y[j + 1] - y[j]) * (t - j)); }
  }
  const dm = Math.floor(rate * 0.0011); for (let i = dm; i < n; i++) { out[i] += level * 0.07 * y[i - dm]; }
  const m = out.length, fade = Math.floor(rate * 0.012);
  let peak = 1e-9; for (let i = 0; i < m; i++) { peak = Math.max(peak, Math.abs(out[i])); }
  for (let i = 0; i < m; i++) {
    const g = Math.min(1, i / fade, (m - 1 - i) / fade);  // 12 ms fade in and out: no click
    out[i] = Math.max(-1, Math.min(1, out[i] / peak * 0.89)) * g;
  }
  return out;
}

function play(samples, rate, onLevel) {
  return new Promise((ok) => {
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource(), an = ctx.createAnalyser();
    src.buffer = buf; an.fftSize = 512;
    src.connect(an); an.connect(ctx.destination);
    const data = new Uint8Array(an.fftSize);
    let on = true;
    const follow = () => { if (!on) { return; } an.getByteTimeDomainData(data); let p = 0; for (const v of data) { p = Math.max(p, Math.abs(v - 128)); } onLevel(Math.min(1, p / 70)); requestAnimationFrame(follow); };
    src.onended = () => { on = false; onLevel(0); ok(); };
    src.start(0); follow();
    current = src;
  });
}
let current = null;
export function stop() { try { if (current) { current.stop(); } } catch (e) { /* ignore */ } if ('speechSynthesis' in window) { speechSynthesis.cancel(); } }

function chunks(text) {  // the voice servers take up to ~400 characters per phrase
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const out = []; let cur = '';
  for (const p of parts) { if ((cur + p).length > 380 && cur) { out.push(cur.trim()); cur = ''; } cur += p; }
  if (cur.trim()) { out.push(cur.trim().slice(0, 400)); }
  return out;
}

function phoneVoice(text) {
  return new Promise((ok) => {
    if (!('speechSynthesis' in window)) { ok(); return; }
    const ru = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('ru'));
    const male = ru.find((v) => /Yuri|Юрий|Maxim|Pavel|Dmitri/i.test(v.name));
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    if (male || ru[0]) { u.voice = male || ru[0]; }
    u.pitch = male ? 0.9 : 0.6;
    u.onend = u.onerror = () => ok();
    speechSynthesis.speak(u);
  });
}

export async function speak(text, onLevel = () => {}) {
  if (store.get('speak') !== '1' || !text) { return; }
  const usePc = await pc.reachable();
  for (const part of chunks(text)) {
    try {
      if (!ctx) { throw new Error('audio locked'); }
      if (usePc) {
        try {
          const buf = await ctx.decodeAudioData(await pc.speech(part));
          await play(buf.getChannelData(0), buf.sampleRate, onLevel);
          continue;
        } catch (e) { /* PC voice busy: try Gemini from the phone */ }
      }
      const { samples, rate } = await geminiSpeech(part);
      await play(robot3(samples, rate), rate, onLevel);
    } catch (e) {
      await phoneVoice(part);
    }
  }
}
