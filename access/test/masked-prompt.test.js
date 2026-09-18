import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { readMaskedLine } from '../lib/masked-prompt.js';

function terminal() {
  const input = new EventEmitter();
  const written = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  input.resume = () => {};
  input.pause = () => {};
  const output = { isTTY: true, write: (value) => written.push(value) };
  return { input, output, written };
}

test('masked credential prompt reads a pasted URL without echo and restores the terminal', async () => {
  const tty = terminal();
  const secret = 'postgres://access_operator:private@db.example/neondb?sslmode=verify-full';
  const reading = readMaskedLine(tty);
  tty.input.emit('data', Buffer.from(secret));
  tty.input.emit('data', Buffer.from('\r'));
  assert.equal(await reading, secret);
  assert.equal(tty.input.isRaw, false);
  assert.equal(tty.written.join(''), 'access_operator DATABASE_URL: \n');
});

test('masked credential prompt cancels safely and refuses non-terminal input', async () => {
  const tty = terminal();
  const reading = readMaskedLine(tty);
  tty.input.emit('data', Buffer.from('\u0003'));
  await assert.rejects(reading, /cancelled/);
  assert.equal(tty.input.isRaw, false);
  await assert.rejects(readMaskedLine({ input: { isTTY: false }, output: { isTTY: false } }), /terminal is required/);
});
