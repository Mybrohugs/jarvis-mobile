// TV controls load independently of the optional cloud AI SDK.
import { playVideo, sharedVideo } from './tv.js';
import { configured, pair } from './pc.js';
const $ = id => document.getElementById(id);
const devPhone = window.location.protocol === 'https:' &&
  window.location.hostname.endsWith('.ts.net') && (window.location.port === '8443' ||
    String(window.location.pathname || '').startsWith('/jarvis-dev/'));
if (devPhone) {
  document.body?.classList.add('chatgptdevmode');
  $('tvdev').hidden = false;
  $('tvpair').hidden = configured();
  if (configured()) { $('tvmsg').textContent = 'Подключение сохранено. Код повторно не нужен.'; }
  $('tvpanel').open = true;
}
$('tvpairbutton').onclick = async () => {
  if ($('tvpairbutton').disabled) { return; }
  $('tvpairbutton').disabled = true;
  try {
    await pair(window.location.origin + (String(window.location.pathname || '').startsWith('/jarvis-dev/') ? '/jarvis-dev' : ''), $('tvcode').value);
    $('tvcode').value = '';
    $('tvpair').hidden = true;
    $('tvmsg').textContent = 'Телефон подключён. Вставьте ссылку и нажмите «На ТВ».';
  } catch (error) { $('tvpairstate').textContent = error.message; }
  finally { $('tvpairbutton').disabled = false; }
};

// Sharing fills the form; only an explicit press sends the request.
const shared = sharedVideo(window.location.search);
if (shared) { $('tvurl').value = shared; $('tvpanel').open = true; }
$('tvform').onsubmit = async (event) => {
  event.preventDefault();
  if ($('tvsend').disabled) { return; }
  $('tvsend').disabled = true;
  $('tvmsg').textContent = 'Отправляю через компьютер…';
  try { $('tvmsg').textContent = (await playVideo($('tvurl').value)).speech; }
  catch (error) { $('tvmsg').textContent = error.message; }
  finally { $('tvsend').disabled = false; }
};
