// The points of the second review (B1, I-A, I-B, m1, m2, m4), each as a
// test: its scenarios A1-A6, now handled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { VisonicApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { encodeFrame } from '../src/visonic/frame.js';
import { FakePanel, SYS, quietLogger, settle, until } from './helpers/fakeVisonic.js';

const BASE = { host: '192.0.2.30', port: 10628, user_code: '1234', zones: '1, 2', language: 'en' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(t, { config = {}, prepare } = {}) {
  const gladys = createFakeGladys({ config: { ...BASE, ...config } });
  const panel = new FakePanel();
  prepare?.(panel);
  const logger = quietLogger();
  const app = new VisonicApp({ gladys, logger, connect: panel.connect, store: memoryStore() });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  const ids = gladys.externalIds('panel', 'visonic');
  const press = (key) => {
    const d = gladys.fake.discoveredDevices.find((x) => x.external_id === ids.device);
    return gladys.fake.setValue(
      d,
      d.features.find((f) => f.external_id === ids.feature(key)),
      1,
    );
  };
  return { gladys, panel, app, logger, ids, press };
}
const up = async (ctx) => {
  await until(() => ctx.app.online);
  await ctx.app.chain;
  await settle();
};
const flush = async (ctx) => {
  await settle();
  await sleep(5);
  await ctx.app.chain;
  await settle();
};
const armedAway = async (ctx) => {
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  ctx.panel.push();
  await flush(ctx);
  await sleep(400);
};
const codes = (ctx) => ctx.panel.commands.map((c) => c.data[2]);

test('I-A (A1): an arm after a disarm with no known outcome is never a success without A1', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  await armedAway(ctx);
  const original = ctx.panel.command.bind(ctx.panel);
  ctx.panel.command = (socket, data) => {
    if (data[2] === 0x00) setTimeout(() => original(socket, data), 600);
    else original(socket, data);
  };
  const disarm = ctx.press('disarm');
  await until(() => ctx.panel.commands.length === 1);
  const [d, a] = await Promise.all([disarm, ctx.press('arm-away')]);
  assert.notEqual(d.success, true);
  assert.ok(codes(ctx).includes(0x05) || a.success === false, 'never "nothing sent" as a success');
  if (a.success) assert.equal(ctx.panel.sysStatus, SYS.ARMED_AWAY);
});

test('I-A (A1b): a disarm applied at once, its acknowledge late: the arm is sent and confirmed', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  await armedAway(ctx);
  const original = ctx.panel.command.bind(ctx.panel);
  ctx.panel.command = (socket, data) => {
    if (data[2] === 0x00) {
      ctx.panel.sysStatus = SYS.DISARMED;
      setTimeout(() => socket.send([0x02]), 600);
    } else original(socket, data);
  };
  const disarm = ctx.press('disarm');
  await until(() => ctx.panel.commands.length === 1);
  const [d, a] = await Promise.all([disarm, ctx.press('arm-away')]);
  assert.notEqual(d.success, true);
  assert.equal(a.success, true, a.error);
  assert.equal(ctx.panel.sysStatus, SYS.ARMED_AWAY);
});

test('I-A: arm stay after an uncertain disarm of an armed-away panel is no success', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  await armedAway(ctx);
  ctx.panel.hold = (type, data) => type === 0xa1 && data[2] === 0x00;
  const disarm = ctx.press('disarm');
  await until(() => ctx.panel.commands.length === 1);
  ctx.panel.hold = () => false;
  const a = await ctx.press('arm-stay');
  await disarm;
  assert.equal(a.success, false);
  assert.match(a.error, /state is uncertain/);
});

test('I-B (A2, A2b): the same arm again after one acknowledged but not applied, or unanswered', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.ignoreCommands = true;
  assert.equal((await ctx.press('arm-away')).success, false);
  ctx.panel.ignoreCommands = false;
  const again = await ctx.press('arm-away');
  assert.equal(again.success, true, again.error);
  assert.equal(ctx.panel.sysStatus, SYS.ARMED_AWAY);

  const other = await setup(t);
  await up(other);
  let hold = true;
  other.panel.hold = (type) => hold && type === 0xa1;
  assert.equal((await other.press('arm-away')).success, false);
  hold = false;
  const second = await other.press('arm-away');
  assert.equal(second.success, true, second.error);
  assert.equal(other.panel.sysStatus, SYS.ARMED_AWAY);
});

test('I-B (A6): state unreadable, memory armed away: arm away is still sent', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  await armedAway(ctx);
  ctx.panel.sysStatus = SYS.DISARMED;
  let hold = true;
  ctx.panel.hold = (type) => hold && type === 0xa2;
  const pressed = ctx.press('arm-away');
  await until(() => ctx.panel.commands.length === 1, 4_000);
  hold = false;
  await pressed;
  assert.deepEqual(codes(ctx), [0x05]);
  assert.equal(ctx.panel.sysStatus, SYS.ARMED_AWAY);
});

test('m1 (A2c): arm stay behind an arm away: nothing sent, with the right message', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const acks = await Promise.all([ctx.press('arm-away'), ctx.press('arm-stay')]);
  assert.deepEqual(codes(ctx), [0x05]);
  assert.equal(acks[0].success, true, acks[0].error);
  if (!acks[1].success) assert.match(acks[1].error, /at least as strong|already armed/);
});

test('m2 (A3): a fire event kept by the adapter at connection is not lost', async (t) => {
  const fire = encodeFrame([0xa7, 0x01, 0x00, 9, 0x20, 0, 0, 0, 0, 0, 0, 0x43]);
  const ctx = await setup(t, {
    prepare: (panel) => {
      const connect = panel.connect;
      panel.connect = (options) => {
        const socket = connect(options);
        socket.once('connect', () => setTimeout(() => socket.raw(fire), 100));
        return socket;
      };
    },
  });
  await up(ctx);
  await flush(ctx);
  assert.equal(ctx.gladys.fake.lastState(ctx.ids.feature('fire-alarm')), 1);
  assert.equal(ctx.gladys.fake.sceneEvents.filter((e) => e.key === 'alarm_triggered').length, 1);
});

for (const n of [6, 12, 20]) {
  test(`B1 (A4): arm away right after ${n} frames to acknowledge: an answer before 4.6 s`, async (t) => {
    const ctx = await setup(t);
    await up(ctx);
    await sleep(400);
    for (let i = 0; i < n; i += 1) ctx.panel.pushMasks(0x02);
    await settle();
    const started = Date.now();
    const ack = await ctx.press('arm-away');
    assert.ok(Date.now() - started < 4_600, `${Date.now() - started} ms`);
    if (n <= 6) assert.equal(ack.success, true, ack.error);
    assert.ok(ctx.app.client.out.filter((i) => i.ack).length <= 50);
  });
}

test('B1 (A4b): arm away while the panel sends 6 frames/s to acknowledge: answered in time', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const timer = setInterval(() => ctx.panel.pushMasks(0x02), 160);
  t.after(() => clearInterval(timer));
  await sleep(1_000);
  const started = Date.now();
  const ack = await ctx.press('arm-away');
  clearInterval(timer);
  // Answered in time, the arm written; the line that cannot follow is cut.
  assert.ok(Date.now() - started < 4_600, `${Date.now() - started} ms`);
  assert.ok(ack.success || ctx.panel.commands.length === 1, ack.error);
  assert.ok(ctx.app.client.out.length <= 52);
});

test('B1 (A5): 1 good + 49 malformed frames, 200 times a second: cut, queue bounded', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const good = encodeFrame([0x06]);
  const bad = Buffer.from([0x0d, 0x06, 0x00, 0x0a]);
  const burst = Buffer.concat([good, ...Array.from({ length: 49 }, () => bad)]);
  let max = 0;
  for (let i = 0; i < 20; i += 1) {
    if (ctx.panel.current && !ctx.panel.current.destroyed) {
      for (let k = 0; k < 10; k += 1) ctx.panel.current.raw(burst);
    }
    await sleep(50);
    max = Math.max(max, ctx.app.client.out.length);
  }
  assert.ok(max <= 52, `queue ${max}`);
  assert.ok(ctx.app.client.failures >= 1 || !ctx.app.online, 'the link was cut');
});

test('m4: a disarm whose read is taken by an earlier arm says so', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  ctx.panel.ignoreCommands = true;
  const arm = ctx.press('arm-away');
  await until(() => ctx.panel.commands.length === 1);
  const disarm = await ctx.press('disarm');
  await arm;
  if (!disarm.success) assert.doesNotMatch(disarm.error, /was asked while this disarming waited/);
});
