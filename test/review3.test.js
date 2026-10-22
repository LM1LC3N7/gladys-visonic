// The point of the third review (R-1): acknowledges capped, frames always
// decoded, the link never cut by a short incident (scenarios C1, C2, C4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { VisonicApp } from '../src/app.js';
import { LIMITS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { VisonicClient } from '../src/visonic/client.js';
import { FakePanel, SYS, quietLogger, settle, until } from './helpers/fakeVisonic.js';

const BASE = { host: '192.0.2.30', port: 10628, user_code: '1234', zones: '1, 2', language: 'en' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(t) {
  const gladys = createFakeGladys({ config: BASE });
  const panel = new FakePanel();
  const logger = quietLogger();
  const app = new VisonicApp({ gladys, logger, connect: panel.connect, store: memoryStore() });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  const ids = gladys.externalIds('panel', 'visonic');
  await until(() => app.online);
  await app.chain;
  await settle();
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
const flush = async (ctx) => {
  await settle();
  await sleep(5);
  await ctx.app.chain;
  await settle();
};
const fireSeen = (ctx) =>
  ctx.gladys.fake.lastState(ctx.ids.feature('fire-alarm')) === 1 &&
  ctx.gladys.fake.sceneEvents.some((e) => e.key === 'alarm_triggered' && e.data.kind === 'fire');

test('C1: a quick sequence of reports then a fire: seen, link kept', async (t) => {
  const ctx = await setup(t);
  const { panel } = ctx;
  panel.zones.open.add(1);
  panel.pushMasks(0x02);
  panel.push({ zone: 2, event: 5 });
  panel.sysStatus = SYS.ARMING_AWAY;
  panel.push();
  panel.sysStatus = SYS.ARMED_AWAY;
  panel.push();
  panel.sysFlags |= 0x80;
  panel.push();
  panel.events([[9, 0x20]]);
  await flush(ctx);
  assert.ok(fireSeen(ctx));
  assert.equal(ctx.app.online, true);
});

test('C2: an incident burst of 20 frames with a fire in it, then an arm: seen, link kept', async (t) => {
  const ctx = await setup(t);
  const { panel } = ctx;
  for (let i = 0; i < 20; i += 1) {
    if (i === 14) panel.events([[9, 0x20]]);
    else if (i % 3 === 0) panel.push();
    else panel.pushMasks(0x01);
  }
  await flush(ctx);
  assert.ok(fireSeen(ctx));
  assert.equal(ctx.app.online, true);
  assert.equal(ctx.panel.sockets.length, 1, 'never reconnected');
});

test('C4: a fire behind 12 frames to acknowledge: seen', async (t) => {
  const ctx = await setup(t);
  for (let i = 0; i < 12; i += 1) ctx.panel.pushMasks(0x01);
  ctx.panel.events([[9, 0x20]]);
  await flush(ctx);
  assert.ok(fireSeen(ctx));
  assert.equal(ctx.app.online, true);
});

test('199 good frames a second for 60 s: every frame decoded, the queue at its cap, never cut', () => {
  let now = 0;
  const timers = {
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  const logger = quietLogger();
  const client = new VisonicClient({ now: () => now, timers, logger });
  const socket = {
    write: () => true,
    writableLength: 0,
    removeAllListeners() {},
    on() {},
    destroy() {},
  };
  client.socket = socket;
  client.second = { at: 0, frames: 0 };
  client.lastWriteAt = 0;
  let events = 0;
  client.on('events', () => {
    events += 1;
  });
  const data = Buffer.from([1, 0, 9, 0x20, 0, 0, 0, 0, 0, 0, 0x43]);
  let max = 0;
  let cutAt;
  return (async () => {
    for (let s = 0; s < 60 && cutAt === undefined; s += 1) {
      for (let i = 0; i < 199; i += 1) {
        now = s * 1_000 + i * 5;
        client.frame(client.generation, { type: 0xa7, data });
        max = Math.max(max, client.out.length);
      }
      await new Promise((resolve) => queueMicrotask(resolve));
      if (!client.socket) cutAt = s;
    }
    assert.ok(max <= LIMITS.maxAcksWaiting, `queue ${max}`);
    assert.equal(cutAt, undefined, 'the memory is bounded: never cut for the acknowledges');
    assert.equal(events, 199 * 60, 'every frame decoded');
    assert.ok(logger.lines.filter((l) => l.includes('not sent, the line')).length <= 2);
  })();
});

test('0.1.2 n2: a command whose connection a guard cuts says "connection cut"', async (t) => {
  const gladys = createFakeGladys({ config: { ...BASE, allow_disarm: true } });
  const panel = new FakePanel();
  const logger = quietLogger();
  const app = new VisonicApp({ gladys, logger, connect: panel.connect, store: memoryStore() });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  await until(() => app.online);
  await app.chain;
  await settle();
  panel.sysStatus = SYS.ARMED_AWAY;
  panel.hold = (type) => type === 0xa2;
  const ids = gladys.externalIds('panel', 'visonic');
  const d = gladys.fake.discoveredDevices.find((x) => x.external_id === ids.device);
  const pressed = gladys.fake.setValue(
    d,
    d.features.find((f) => f.external_id === ids.feature('disarm')),
    1,
  );
  await until(() => panel.statusRequests.length >= 2);
  // A flood: more than 200 frames in a second, the guard cuts the link.
  const flood = Buffer.concat(
    Array.from({ length: 210 }, () => Buffer.from([0x0d, 0x0b, 0xf4, 0x0a])),
  );
  panel.current.raw(flood);
  const ack = await pressed;
  assert.equal(ack.success, false);
  assert.match(ack.error, /connection to the panel was cut/);
  assert.equal(panel.commands.length, 0);
});
