// Uses the existing paired-PC queue. No HA token or device address on the phone.
import { configured, say, queueItem } from './pc.js';

export function videoUrl(value) {
  const text = String(value || '').trim();
  if (/^https?:\/\/https?:\/\//i.test(text)) { throw new Error('В ссылке дважды указан https://. Вставьте адрес заново.'); }
  let url;
  try { url = new URL(text); } catch { throw new Error('Вставьте полную ссылку HTTP/HTTPS на видео.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      text.length > 500 || /\s/.test(text)) {
    throw new Error('Нужна ссылка HTTP/HTTPS без пароля, до 500 символов.');
  }
  return text;
}

export function sharedVideo(search) {
  const params = new URLSearchParams(search);
  for (const field of ['url', 'text']) {
    const match = (params.get(field) || '').match(/https?:\/\/[^\s<>"']+/i);
    if (match) {
      try { return videoUrl(match[0].replace(/[),.;!?]+$/, '')); } catch { /* next field */ }
    }
  }
  return '';
}

export async function playVideo(value) {
  const url = videoUrl(value);
  if (!configured()) { throw new Error('Сначала подключите компьютер в настройках.'); }
  let result;
  try {
    result = await say('на телевизор ' + url);
  } catch (error) {
    throw new Error(error.message + ' Проверьте очередь ПК и ТВ перед повторной отправкой.');
  }
  if (!result.id) { throw new Error('ПК не подтвердил запрос. Проверьте очередь перед повтором.'); }
  const pending = { ...result, queued: true, speech: 'Запрос в очереди ПК. Воспроизведение ещё не подтверждено; проверьте ТВ и очередь на ПК.' };
  if (result.queued || result.status === 'pending') {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        const item = await queueItem(result.id);
        if (item && ['done', 'failed', 'dismissed'].includes(item.status)) {
          result = { ...item, queued: false };
          break;
        }
      } catch {
        return { ...pending, speech: 'Запрос принят, но связь с очередью ПК потеряна. Проверьте ТВ перед повторной отправкой.' };
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (result.queued || result.status === 'pending') { return pending; }
  }
  if (['failed', 'dismissed'].includes(result.status)) {
    throw new Error(result.speech || 'Запрос не выполнен. Проверьте ПК и телевизор.');
  }
  if (result.status !== 'done') {
    throw new Error('ПК вернул неизвестный результат. Проверьте очередь перед повтором.');
  }
  return { ...result, speech: result.speech || 'Команда передана телевизору. Воспроизведение пока не подтверждено.' };
}
