import { configured, pair, reachable } from './pc.js';
const $ = id => document.getElementById(id);
const gatewayBase = window.location.origin + (window.location.pathname.startsWith('/jarvis-dev/') ? '/jarvis-dev' : '');
$('address').textContent = gatewayBase;
// A user-opened pairing link may prefill a one-time code, never submit it.
const linkedCode = new URLSearchParams(window.location.hash.slice(1)).get('code');
if (/^[0-9]{6}$/.test(linkedCode || '')) {
  $('code').value = linkedCode;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
$('pairform').onsubmit = async event => {
  event.preventDefault();
  if ($('connect').disabled) return;
  $('connect').disabled = true;
  $('message').textContent = 'Подключаю…';
  try {
    await pair(gatewayBase, $('code').value);
    $('code').value = '';
    $('pairform').hidden = true;
    $('message').textContent = 'Телефон подключён. Код сохранён, повторно вводить его не нужно.';
    $('open').hidden = false;
  } catch (error) {
    $('message').textContent = /pairing closed/.test(error.message)
      ? 'Окно сопряжения на этом DEV-сервисе закрыто. Нужен новый код с компьютера.'
      : error.message;
  } finally { $('connect').disabled = false; }
};
if (configured()) {
  reachable(true).then(ok => {
    if (ok) {
      $('pairform').hidden = true;
      $('message').textContent = 'Этот браузер уже подключён. Новый код не нужен.';
      $('open').hidden = false;
    }
  });
}
