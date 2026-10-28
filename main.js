// JARVIS Mobile: works on its own (Claude + Gemini + Google Calendar); the home PC is optional (files).
import * as store from './store.js';
import * as brain from './brain.js';
import * as voice from './voice.js';
import * as google from './google.js';
import * as pc from './pc.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) { n.className = cls; } if (text !== undefined) { n.textContent = text; } return n; };
const orb = window.JarvisOrb;

const STATES = { standby: 'нажмите и говорите', listening: 'слушаю', thinking: 'думаю', speaking: 'говорю', error: 'сбой' };
function setState(name) { $('state').textContent = STATES[name]; orb.setState(name); }
function show(text) { $('reply').textContent = text; }
function voiceNote() {  // say on screen why the phone's own voice was used instead of JARVIS's
  if (voice.lastError) { show(($('reply').textContent + ' [голос Gemini: ' + voice.lastError + ']').trim()); voice.clearError(); }
}

// ---------- one exchange: text in, spoken answer out ----------
let busy = false;
async function handle(text) {
  text = text.trim();
  if (!text || busy) { return; }
  busy = true;
  $('extra').replaceChildren();
  setState('thinking');
  show('');
  const t0 = performance.now();
  try {
    const briefing = /^(брифинг|доброе утро|что у меня сегодня)\b/i.test(text);
    const answer = await brain.ask(briefing ? 'Сделай утренний брифинг: погода сегодня, мои встречи сегодня и завтра утром. ' + text : text);
    $('lat').textContent = String(Math.round(performance.now() - t0));
    show(answer);
    for (const x of brain.takeExtras()) { if (x.kind === 'file') { fileButton(x.link); } }
    setState('speaking');
    await voice.speak(answer, (l) => orb.setLevel(l));
    voiceNote();
    setState('standby');
  } catch (e) {
    show('Сбой: ' + e.message);
    setState('error');
  } finally {
    busy = false;
    orb.setLevel(0);
  }
}

$('ask').onsubmit = (e) => { e.preventDefault(); voice.unlock(); const t = $('say').value; $('say').value = ''; handle(t); };

// ---------- push-to-talk: hold the orb or the mic; a short tap starts, the next tap sends ----------
let recording = null;
async function talkDown(e) {
  e.preventDefault();
  voice.unlock();  // inside the gesture (iOS)
  if (recording) { voice.stopRecording(); return; }
  if (busy) { voice.stop(); return; }  // a tap while JARVIS talks: stop talking
  try {
    $('extra').replaceChildren(); show('');
    recording = voice.startRecording((l) => { orb.setLevel(l); $('lvl').textContent = String(Math.round(l * 99)).padStart(2, '0'); });
    setState('listening'); $('mic').classList.add('on');
    const blob = await recording;
    recording = null; $('mic').classList.remove('on'); $('lvl').textContent = '00'; orb.setLevel(0);
    if (blob.size < 2000) { setState('standby'); return; }
    setState('thinking');
    const text = await voice.transcribe(blob);
    if (!text) { show('Не расслышал, сэр.'); setState('standby'); return; }
    await handle(text);
  } catch (err) {
    recording = null; $('mic').classList.remove('on');
    show(err.name === 'NotAllowedError' ? 'Нет доступа к микрофону: разрешите его в настройках телефона.' : 'Сбой: ' + err.message);
    setState('error');
  }
}
function talkUp() { if (recording && voice.heldFor() > 600) { voice.stopRecording(); } }
for (const id of ['reactor', 'mic']) {
  $(id).addEventListener('pointerdown', talkDown);
  $(id).addEventListener('pointerup', talkUp);
  $(id).addEventListener('pointercancel', talkUp);
  $(id).addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- files ----------
function fileButton(link) {
  const b = el('button', 'wide', 'Сохранить файл с компьютера');
  b.type = 'button';
  b.onclick = async () => {
    b.textContent = 'Загрузка…';
    try {
      const { name, blob } = await pc.download(link);
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); }  // iOS: «Сохранить в Файлы»
      else { const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
      b.textContent = 'Готово: ' + name;
    } catch (e) { b.textContent = 'Не удалось: ' + e.message; }
  };
  $('extra').append(b);
}

$('upload').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) { return; }
  if (!(await pc.reachable(true))) { $('upmsg').textContent = 'Компьютер недоступен: он выключен или на телефоне не включён Tailscale.'; return; }
  for (const f of files) {
    $('upmsg').textContent = 'Отправляю ' + f.name + '…';
    try { const r = await pc.upload(f); $('upmsg').textContent = 'Сохранено на компьютере: ' + r.saved_as; }
    catch (err) { $('upmsg').textContent = 'Не удалось (' + f.name + '): ' + err.message; return; }
  }
};

$('findform').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('findq').value.trim();
  const ul = $('findlist');
  ul.replaceChildren(el('li', 'muted', 'Ищу…'));
  try {
    if (!(await pc.reachable(true))) { throw new Error('компьютер недоступен'); }
    const r = await pc.find(q);
    ul.replaceChildren();
    const lines = (r.text || '').split('\n').filter(Boolean);
    if (!lines.length) { ul.append(el('li', 'muted', r.speech || 'Ничего не нашёл.')); return; }
    lines.forEach((line, i) => {
      const li = el('li', '', line);
      const b = el('button', '', 'На телефон');
      b.type = 'button';
      b.onclick = async () => {
        b.textContent = 'Готовлю…';
        try { const s = await pc.send(i + 1); if (!s.link) { throw new Error(s.speech || 'нет ссылки'); }
          const { name, blob } = await pc.download(s.link);
          const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); }
          else { const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
          b.textContent = 'Готово';
        } catch (err) { b.textContent = 'Не удалось: ' + err.message; }
      };
      li.append(el('br'), b);
      ul.append(li);
    });
  } catch (err) { ul.replaceChildren(el('li', 'muted', 'Не получилось: ' + err.message)); }
};

// ---------- calendar ----------
async function loadCalendar() {
  const ul = $('callist');
  if (!google.configured()) { ul.replaceChildren(el('li', 'muted', 'Укажите Client ID Google в настройках.')); return; }
  if (!google.signedIn()) { ul.replaceChildren(el('li', 'muted', 'Нажмите «Обновить», чтобы войти в Google.')); return; }
  ul.replaceChildren(el('li', 'muted', 'Загружаю…'));
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 7 * 86400000);
    const items = await google.events(from.toISOString(), to.toISOString(), 50);
    ul.replaceChildren();
    if (!items.length) { ul.append(el('li', 'muted', 'На неделю встреч нет.')); return; }
    let day = '';
    for (const it of items) {
      const d = new Date(it.start);
      const label = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
      if (label !== day) { day = label; ul.append(el('li', 'day', label)); }
      const li = el('li');
      li.append(el('div', 'when', it.allDay ? 'весь день' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })),
        el('div', 'task', it.title));
      if (it.where) { li.append(el('div', 'muted small', it.where)); }
      ul.append(li);
    }
  } catch (e) { ul.replaceChildren(el('li', 'muted', 'Не получилось: ' + e.message)); }
}
$('calrefresh').onclick = async () => {
  if (google.configured() && !google.signedIn()) {
    try { await google.signIn(); } catch (e) { $('callist').replaceChildren(el('li', 'muted', 'Вход не выполнен: ' + e.message)); return; }
  }
  loadCalendar();
};

// ---------- tabs & settings ----------
document.querySelectorAll('.tab').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.id !== b.dataset.tab; });
    if (b.dataset.tab === 'calendar') { loadCalendar(); }
  };
});

const FORM = { claudekey: 'claudeKey', geminikey: 'geminiKey', model: 'model', gclient: 'googleClientId', pcurl: 'pcUrl', city: 'city' };
function fillSettings() {
  for (const [id, key] of Object.entries(FORM)) { $(id).value = store.get(key); }
  $('speak').checked = store.get('speak') === '1';
  $('gstate').textContent = !google.configured() ? 'Не настроено.' : google.signedIn() ? 'Вход выполнен.' : 'Нужно войти.';
  $('pcmsg').textContent = pc.configured() ? 'Компьютер подключён.' : 'Не подключён (нужен только для файлов).';
}
function settings(open) { if (open) { fillSettings(); } $('settings').hidden = !open; }
$('gear').onclick = () => settings(true);
$('close').onclick = () => settings(false);
$('settings').onclick = (e) => { if (e.target === $('settings')) { settings(false); } };
$('save').onclick = async () => {
  for (const [id, key] of Object.entries(FORM)) { if (id !== 'pcurl' || $(id).value.trim()) { store.set(key, $(id).value.trim()); } }
  store.set('speak', $('speak').checked ? '1' : '0');
  settings(false);
  status();
};
$('glogin').onclick = async () => {
  store.set('googleClientId', $('gclient').value.trim());
  $('gstate').textContent = 'Открываю Google…';
  try { await google.signIn(); }
  catch (e) { $('gstate').textContent = 'Не получилось: ' + e.message; }
};
$('pcpair').onclick = async () => {
  $('pcmsg').textContent = 'Подключаю…';
  try { await pc.pair($('pcurl').value, $('pccode').value); $('pccode').value = ''; $('pcmsg').textContent = 'Компьютер подключён.'; status(); }
  catch (e) { $('pcmsg').textContent = 'Не получилось: ' + e.message; }
};
$('soundtest').onclick = () => { voice.unlock(); settings(false); setState('speaking'); show(''); voice.speak('Звук работает. На связи JARVIS.', (l) => orb.setLevel(l)).then(() => { voiceNote(); setState('standby'); }); };
$('briefing').onclick = () => { voice.unlock(); settings(false); handle('брифинг'); };
$('forget').onclick = () => {
  if (!confirm('Стереть с этого телефона все ключи и настройки JARVIS?')) { return; }
  store.wipe(); google.signOut(); try { sessionStorage.clear(); } catch (e) { /* ignore */ }
  brain.reset(); fillSettings(); status();
};
let wakeLock = null;
$('awake').onchange = async (e) => {
  try { if (e.target.checked) { wakeLock = await navigator.wakeLock.request('screen'); } else if (wakeLock) { await wakeLock.release(); wakeLock = null; } }
  catch (err) { e.target.checked = false; }
};

// ---------- status line & clock ----------
async function status() {
  const up = await pc.reachable(true);
  $('pcstate').textContent = !pc.configured() ? 'не подключён' : up ? 'на связи' : 'нет связи';
  $('dot').classList.toggle('off', !store.get('claudeKey'));
  $('conn').textContent = store.get('claudeKey') ? 'в сети' : 'нет ключа';
}
function clock() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  $('date').textContent = d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
clock(); setInterval(clock, 15000);
setInterval(status, 60000);
orb.mount($('orb'));
status();
if (google.lastError) { show('Вход в Google не выполнен: ' + google.lastError + '.'); }
else if (location.hash === '' && google.signedIn() && sessionStorage.getItem('jarvis.gshown') !== '1') {
  try { sessionStorage.setItem('jarvis.gshown', '1'); } catch (e) { /* ignore */ }
  show('Вход в Google выполнен, сэр. Календарь подключён.');
} else if (!store.get('claudeKey')) { show('Добро пожаловать, сэр. Откройте настройки (шестерёнка) и введите ключ Claude.'); }
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
