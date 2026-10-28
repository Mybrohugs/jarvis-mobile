// Google Calendar through Google Identity Services (browser OAuth, short-lived token, no secret).
// Scope: calendar.events only (read and create events; nothing else in the account).
import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
let token = '', expires = 0, client = null, pending = null;

try {  // a token survives a reload of the app within its hour
  const saved = JSON.parse(sessionStorage.getItem('jarvis.gtoken') || 'null');
  if (saved && saved.expires > Date.now()) { token = saved.token; expires = saved.expires; }
} catch (e) { /* ignore */ }

export const configured = () => /\.apps\.googleusercontent\.com$/.test(store.get('googleClientId'));
export const signedIn = () => !!token && Date.now() < expires - 60000;

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) { return Promise.resolve(); }
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ok;
    s.onerror = () => fail(new Error('не загрузился вход Google'));
    document.head.append(s);
  });
}

export async function prepare() {  // load the library early, so sign-in can open inside the tap
  if (!configured()) { return; }
  await loadGis();
  client = google.accounts.oauth2.initTokenClient({
    client_id: store.get('googleClientId'), scope: SCOPE,
    callback: (r) => {
      const p = pending; pending = null;
      if (r.error || !r.access_token) { if (p) { p.fail(new Error(r.error_description || r.error || 'вход отменён')); } return; }
      token = r.access_token;
      expires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
      try { sessionStorage.setItem('jarvis.gtoken', JSON.stringify({ token, expires })); } catch (e) { /* ignore */ }
      if (p) { p.ok(); }
    },
    error_callback: (e) => { const p = pending; pending = null; if (p) { p.fail(new Error(e.message || e.type || 'окно входа закрыто')); } },
  });
}

// Must be called straight from a tap (iOS blocks pop-ups otherwise).
export function signIn() {
  if (!client) { return Promise.reject(new Error('сначала укажите Client ID и сохраните')); }
  return new Promise((ok, fail) => {
    pending = { ok, fail };
    client.requestAccessToken({ prompt: store.get('googleConsented') ? '' : 'consent' });
  }).then(() => store.set('googleConsented', '1'));
}

async function api(url, opts = {}) {
  if (!signedIn()) { throw new Error('нужно войти в Google: Настройки → «Войти в Google»'); }
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { token = ''; throw new Error('вход в Google истёк: нажмите «Войти в Google»'); }
  const data = r.status === 204 ? {} : await r.json();
  if (!r.ok) { throw new Error((data.error && data.error.message) || 'Google HTTP ' + r.status); }
  return data;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function events(fromIso, toIso, max = 25) {
  const q = new URLSearchParams({ timeMin: new Date(fromIso).toISOString(), timeMax: new Date(toIso).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(50, max)) });
  const data = await api(API + '?' + q);
  return (data.items || []).map((e) => ({
    title: e.summary || '(без названия)',
    start: e.start && (e.start.dateTime || e.start.date), end: e.end && (e.end.dateTime || e.end.date),
    allDay: !!(e.start && e.start.date), where: e.location || '', link: e.hangoutLink || '',
  }));
}

// A reminder is an event with a popup alert: Google's own app/notifications deliver it on any phone.
export async function addEvent({ title, start, end, remindMinutes, notes }) {
  const s = new Date(start);
  if (!title || isNaN(s)) { throw new Error('нужны название и время'); }
  const e = end ? new Date(end) : new Date(s.getTime() + 30 * 60000);
  const body = {
    summary: String(title).slice(0, 200), description: notes ? String(notes).slice(0, 2000) : undefined,
    start: { dateTime: s.toISOString(), timeZone: tz() }, end: { dateTime: e.toISOString(), timeZone: tz() },
    reminders: remindMinutes === undefined || remindMinutes === null ? { useDefault: true }
      : { useDefault: false, overrides: [{ method: 'popup', minutes: Math.max(0, Math.min(40320, Math.round(remindMinutes))) }] },
  };
  const made = await api(API, { method: 'POST', body: JSON.stringify(body) });
  return { title: made.summary, start: made.start && made.start.dateTime, link: made.htmlLink };
}
