import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chunks } from '../speech_text.js';

test('long sentences and long tokens retain all text within voice limits', () => {
  for (const limit of [380, 1000, 1500]) {
    const words = Array(900).fill('проверка').join(' ');
    const parts = chunks(words, limit);
    assert.equal(parts.join(' '), words);
    assert.ok(parts.every((p) => p.length <= limit));
    const token = 'я'.repeat(4000);
    assert.equal(chunks(token, limit).join(''), token);
  }
});

test('sentence boundaries and punctuation remain audible', () => {
  assert.deepEqual(chunks('Первое. Второе! Третье?', 16), ['Первое. Второе!', 'Третье?']);
  assert.deepEqual(chunks('...!?', 3), ['...', '!?']);
  assert.deepEqual(chunks(' \n ', 10), []);
});

// Run the real speak orchestration with network/audio dependencies replaced: no browser needed.
async function fallback(text, failAt = -1) {
  const requested = [], heard = [], phone = [];
  const context = {
    chunks, AbortController, rec: null, stopped: false, abort: null, lastError: '',
    store: { get: () => '1', off: () => true }, session: () => {},
    voiceLine: () => ({ done: Promise.resolve({ played: 0 }), end() {} }),
    pc: {
      knownAlive: () => true,
      speech: async (part) => {
        requested.push(part);
        if (requested.length - 1 === failAt) { throw new Error('PC offline'); }
        return { samples: part, rate: 24000 };
      },
    },
    parseWav: (w) => w, loud: (samples) => samples,
    play: async (samples) => { heard.push(samples); },
    phoneVoice: async (part) => { phone.push(part); },
  };
  const source = fs.readFileSync(new URL('../voice.js', import.meta.url), 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('export async function speak(')).replace('export async function', 'async function'), context);
  await context.speak(text);
  return { requested, heard, phone };
}

test('PC fallback voices the complete answer using gateway-sized requests', async () => {
  const text = Array(600).fill('проверка').join(' ');
  const { requested, heard, phone } = await fallback(text);
  assert.ok(requested.length > 1);
  assert.ok(requested.every((part) => part.length <= 1000));
  assert.equal(heard.join(' '), text);
  assert.deepEqual(phone, []);
});

test('PC failure passes only the unspoken remainder to phone speech', async () => {
  const text = Array(600).fill('проверка').join(' ');
  const { heard, phone } = await fallback(text, 1);
  assert.equal(heard.length, 1);
  assert.ok(phone.length > 1);
  assert.ok(phone.every((part) => part.length <= 380));
  assert.equal([...heard, ...phone].join(' '), text);
});
