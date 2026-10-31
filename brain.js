// ChatGPT via the paired PC. No provider credential is stored on this phone.
import * as store from './store.js';
import * as google from './google.js';
import * as pc from './pc.js';
let messages = [], lastAt = 0;
const extras = [];  // things for the screen (file download buttons), filled by tools
export const takeExtras = () => extras.splice(0);

async function weather(city) {
  const name = (city || store.get('city') || 'Москва').slice(0, 60);
  const places = store.json('places', {});  // a city's coordinates never change: one lookup per city
  let p = places[name.toLowerCase()];
  if (!p) {
    const g = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=' + encodeURIComponent(name))).json();
    const hit = (g.results || [])[0];
    if (!hit) { return 'Город не найден: ' + name; }
    p = { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
    places[name.toLowerCase()] = p;
    const keys = Object.keys(places);
    if (keys.length > 20) { delete places[keys[0]]; }
    store.set('places', JSON.stringify(places));
  }
  const q = new URLSearchParams({ latitude: p.latitude, longitude: p.longitude, timezone: 'auto', forecast_days: '3',
    current: 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' });
  const w = await (await fetch('https://api.open-meteo.com/v1/forecast?' + q)).json();
  return JSON.stringify({ city: p.name, current: w.current, daily: w.daily, weather_code_note: 'WMO codes' });
}

let lastFind = [];
async function runTool(name, input) {
  if (name === 'calendar_events') {
    const items = await google.events(String(input.from), String(input.to));
    return JSON.stringify(items.length ? items : 'событий нет');
  }
  if (name === 'calendar_add') {
    const made = await google.addEvent({ title: input.title, start: input.start, end: input.end,
      remindMinutes: Number.isInteger(input.remind_minutes) ? input.remind_minutes : undefined, notes: input.notes });
    return 'Создано: ' + JSON.stringify(made);
  }
  if (name === 'weather') { return weather(input.city); }
  if (name === 'pc_find' || name === 'pc_send') {
    if (!(await pc.reachable(true))) { return 'Компьютер сейчас недоступен (выключен или нет Tailscale).'; }
    if (name === 'pc_find') {
      const r = await pc.find(String(input.query).slice(0, 100));
      lastFind = r.text ? r.text.split('\n') : [];
      return r.speech + (r.text ? '\n' + r.text : '');
    }
    const r = await pc.send(Number(input.number));
    if (r.link) { extras.push({ kind: 'file', link: r.link }); return 'Файл готов, на экране кнопка «Сохранить». ' + (r.speech || ''); }
    return r.speech || 'Не получилось.';
  }
  throw new Error('unknown tool ' + name);
}


const IDLE_MS = 15 * 60000;
export async function ask(text, extraSystem = '') {
  if (!pc.configured()) { throw new Error('Подключите телефон к ПК в настройках. Ключ ChatGPT не нужен.'); }
  if (Date.now() - lastAt > IDLE_MS || messages.length > 48) { messages = []; }
  lastAt = Date.now();
  messages.push({ role: 'user', content: String(text).slice(0, 12000) });
  const context = 'Сейчас: ' + new Date().toISOString() + '; часовой пояс: ' + Intl.DateTimeFormat().resolvedOptions().timeZone +
    '; город: ' + store.get('city') + '. ' + String(extraSystem).slice(0, 1000);
  try {
    for (let round = 0; round < 8; round++) {
      const res = await pc.chatTurn(messages, context);
      if (!Array.isArray(res.output)) { throw new Error('ПК вернул некорректный ответ ChatGPT.'); }
      messages.push(...res.output);
      const calls = res.output.filter(item => item.type === 'function_call');
      if (!calls.length) { return res.text || 'Готово, сэр.'; }
      for (const call of calls) {
        let output;
        try {
          if (!['calendar_events', 'calendar_add', 'weather'].includes(call.name) || (call.namespace && call.namespace !== 'phone')) {
            throw new Error('Этот инструмент недоступен в DEV.');
          }
          const input = JSON.parse(call.arguments || '{}');
          output = String(await runTool(call.name, input)).slice(0, 12000);
        } catch (e) { output = 'Ошибка: ' + e.message; }
        messages.push({ type: 'function_call_output', call_id: call.call_id, output });
      }
    }
    throw new Error('Слишком много действий. Разделите просьбу на несколько частей.');
  } catch (e) { messages = []; throw e; }
}
export function reset() { messages = []; }
