// The points of the first review (I1-I7, M1-M10), each as a test: the
// hostile scenarios R1-R12 of the review, now refused or handled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { VisonicApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { StatePublisher } from '../src/publisher.js';
import { memoryStore } from '../src/store.js';
import { VisonicClient } from '../src/visonic/client.js';
import { FrameReader, encodeFrame } from '../src/visonic/frame.js';
import { FakePanel, SYS, quietLogger, settle, until } from './helpers/fakeVisonic.js';

const BASE = { host: '192.0.2.30', port: 10628, user_code: '1234', zones: '1, 2', language: 'en' };

async function setup(t, { config = {}, panel: panelOptions = {}, store, prepare } = {}) {
  const gladys = createFakeGladys({ config: { ...BASE, ...config } });
  const panel = new FakePanel(panelOptions);
  prepare?.(panel);
  const logger = quietLogger();
  const memory = store ?? memoryStore();
  const app = new VisonicApp({ gladys, logger, connect: panel.connect, store: memory });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  const panelIds = gladys.externalIds('panel', 'visonic');
  const device = () => gladys.fake.discoveredDevices.find((d) => d.external_id === panelIds.device);
  return {
    gladys,
    panel,
    app,
    logger,
    store: memory,
    panelIds,
    events: () => gladys.fake.sceneEvents,
    press: (key) => {
      const d = device();
      const f = d.features.find((x) => x.external_id === panelIds.feature(key));
      return gladys.fake.setValue(d, f, 1);
    },
  };
}

const up = async (ctx) => {
  await until(() => ctx.app.online);
  await ctx.app.chain;
  await settle();
};
const flush = async (ctx) => {
  await settle();
  await new Promise((r) => setTimeout(r, 5));
  await ctx.app.chain;
  await settle();
};
const ok = (ack) => assert.equal(ack?.success, true, ack?.error);
const logs = (ctx) => ctx.logger.lines.join('\n');

test('I1 (R1): an arm preempts a status read without answer and is written in time', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  let once = true;
  ctx.panel.hold = (type) => {
    if (type === 0xa2 && once) {
      once = false;
      return true;
    }
    return false;
  };
  ctx.app.client.readStatus().catch(() => undefined);
  await settle();
  const started = Date.now();
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.commands.length, 1);
  assert.ok(ctx.panel.commands[0].at - started < 3_500, 'written before its deadline');
});

test('I1: an arm preempts a disarm written and not acknowledged', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_STAY;
  ctx.panel.hold = (type, data) => type === 0xa1 && data[2] === 0x00;
  const disarm = ctx.press('disarm');
  await until(() => ctx.panel.commands.length === 1);
  ctx.panel.hold = () => false;
  ok(await ctx.press('arm-away'));
  const ack = await disarm;
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent to the panel \(disarm\), without confirmation/);
  assert.deepEqual(
    ctx.panel.commands.map((c) => c.data[2]),
    [0x00, 0x05],
  );
});

test('I2 (R2): arm stay over armed away on an unreadable state: nothing sent', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  ctx.panel.push();
  await flush(ctx);
  ctx.panel.hold = (type) => type === 0xa2;
  const ack = await ctx.press('arm-stay');
  assert.equal(ack.success, false);
  assert.match(ack.error, /nothing was sent/);
  assert.equal(ctx.panel.commands.length, 0);
});

test('I2: arm away on an unreadable state is sent blind', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  let hold = true;
  ctx.panel.hold = (type) => hold && type === 0xa2;
  const pressed = ctx.press('arm-away');
  await until(() => ctx.panel.commands.length === 1, 4_000);
  hold = false;
  ok(await pressed);
});

test('I3 (R3): arm away and arm stay at once: armed away, never lowered', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const acks = await Promise.all([ctx.press('arm-away'), ctx.press('arm-stay')]);
  await flush(ctx);
  ok(acks[0]);
  assert.deepEqual(
    ctx.panel.commands.map((c) => c.data[2]),
    [0x05],
  );
  assert.equal(ctx.panel.sysStatus, SYS.ARMED_AWAY);
  // Stay then away: away raises it.
  const other = await setup(t);
  await up(other);
  await Promise.all([other.press('arm-stay'), other.press('arm-away')]);
  assert.deepEqual(
    other.panel.commands.map((c) => c.data[2]),
    [0x04, 0x05],
  );
});

test('I4 (R4): a disarm on an unknown state (0x0E, 0x1F) is refused, nothing sent', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  for (const raw of [0x0e, 0x0f, 0x16, 0x1f]) {
    ctx.panel.sysStatus = raw;
    const ack = await ctx.press('disarm');
    assert.equal(ack.success, false);
    assert.match(ack.error, /could not be read/);
  }
  assert.equal(ctx.panel.commands.length, 0);
  assert.match(logs(ctx), /unknown state 0x0e/);
});

test('I5 (R5): bytes kept by the adapter are not read; an arm after wake() is decided anew', async (t) => {
  const store = memoryStore({ codeStop: null, lastAttemptAt: Date.now() - 1_000, failures: 4 });
  const stale = encodeFrame([0xa5, 0x00, 0x04, SYS.ARMED_AWAY, 0x01, 0, 0, 0, 0, 0, 0, 0x43]);
  const ctx = await setup(t, {
    store,
    prepare: (panel) => {
      const connect = panel.connect;
      panel.connect = (options) => {
        const socket = connect(options);
        socket.once('connect', () => socket.raw(stale));
        return socket;
      };
    },
  });
  await settle();
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.commands.length, 1, 'sent: the real panel was disarmed');
  assert.equal(ctx.panel.sysStatus, SYS.ARMED_AWAY);
  assert.ok(ctx.panel.acks >= 1, 'the kept message was acknowledged');
  await flush(ctx);
  assert.deepEqual(
    ctx.events().map((e) => [e.key, e.data.by_gladys]),
    [['armed', true]],
    'no false armed / disarmed from the kept status',
  );
});

test('I6 (R6): at least 190 ms between two frames, acknowledges included', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  ok(await ctx.press('disarm'));
  const times = ctx.panel.log.map((e) => e.at);
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] - times[i - 1] >= 189, `gap ${times[i] - times[i - 1]} ms at ${i}`);
  }
});

test('I7 (R12): F1, F4 and E1 are cut by their length; nothing after them is lost', () => {
  const got = [];
  const reader = new FrameReader({ onFrame: (f) => got.push(f.type) });
  const f1 = Buffer.from([0x0d, 0xf1, 1, 2, 3, 4, 5, 0x77, 0x0a]);
  const f4 = Buffer.from([0x0d, 0xf4, 0x01, 0, 0, 0, 0xe4, 0xc0, 0x0a]);
  const f405 = Buffer.from([0x0d, 0xf4, 0x05, 0, 0, 2, 0x0a, 0x0a, 0x99, 0x98, 0x0a]);
  const e1 = encodeFrame([0xe1, 1, 2, 0x43]);
  const status = encodeFrame([0xa5, 0x00, 0x04, 0x05, 0x01, 0, 0, 0, 0, 0, 0, 0x43]);
  reader.push(
    Buffer.concat([f1, status, encodeFrame([0x02]), f4, f405, e1, encodeFrame([0x08])]),
    0,
  );
  assert.deepEqual(got, [0xf1, 0xa5, 0x02, 0xf4, 0xf4, 0xe1, 0x08]);
});

test('I7: an access denied is never swallowed by a broken or unknown frame', () => {
  const got = [];
  const reader = new FrameReader({ onFrame: (f) => got.push(f.type) });
  // An unknown type that never ends, then 08.
  reader.push(Buffer.concat([Buffer.from([0x0d, 0x77, 1, 2, 3]), encodeFrame([0x08])]), 0);
  // An A5 cut short (its length reaches into the 08 after it).
  reader.push(Buffer.concat([Buffer.from([0x0d, 0xa5, 0, 4, 0, 1]), encodeFrame([0x08])]), 0);
  reader.push(Buffer.alloc(10, 0x00), 0);
  assert.deepEqual(got, [0x08, 0x08]);
});

test('M1 (R7) and M2 (R8): a flapping fire is announced once; 0x0B logged once', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  for (let i = 0; i < 40; i += 1) {
    ctx.panel.events([[9, 0x20]]);
    await flush(ctx);
    ctx.panel.events([[9, 0x21]]);
    await flush(ctx);
  }
  assert.equal(ctx.events().filter((e) => e.key === 'alarm_triggered').length, 1);
  for (let i = 0; i < 40; i += 1) ctx.panel.current.send([0x0b]); // no acknowledge for 0x0B
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(ctx.logger.lines.filter((l) => l.includes('0x0B')).length, 1);
});

test('M3 (R9): acknowledged then refused: "code refused", never sent again', async (t) => {
  const ctx = await setup(t, {
    config: { user_code: '9999' },
    prepare: (panel) => {
      panel.command = (socket) => {
        socket.send([0x02]);
        setTimeout(() => socket.send([0x08]), 60);
      };
    },
  });
  await up(ctx);
  const ack = await ctx.press('arm-away');
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused the user code/);
  assert.ok(ctx.store.data?.codeStop);
  assert.equal((await ctx.press('arm-away')).success, false);
  assert.equal(ctx.panel.commands.length, 1);
});

test('M4: after a read that timed out, an acknowledge is ambiguous: the state decides', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  let once = true;
  ctx.panel.hold = (type) => {
    if (type === 0xa2 && once) {
      once = false;
      return true;
    }
    return false;
  };
  await ctx.app.client.readStatus({ timeout: 1_000 }).catch(() => undefined);
  assert.equal(ctx.app.client.uncertain, true);
  ok(await ctx.press('arm-away'));
});

test('M5: an acknowledge into a full write buffer cuts the link', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.current.writableLength = 1e9;
  ctx.panel.pushMasks(0x02);
  await until(() => !ctx.app.online);
});

test('M6: the states waiting when a session stops are dropped', () => {
  const sent = [];
  const publisher = new StatePublisher({
    gladys: { publishStates: async (s) => sent.push(...s) },
    logger: console,
    timers: { setTimeout: () => 1, clearTimeout: () => undefined },
  });
  publisher.pending.set('ext:x:zone:1:opening', { device_feature_external_id: 'x', state: 1 });
  publisher.stop();
  assert.equal(publisher.pending.size, 0);
});

test('M7: a new configuration while a command waits its confirmation: never "done"', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.ignoreCommands = true;
  const pressed = ctx.press('arm-away');
  await until(() => ctx.panel.commands.length === 1);
  await ctx.app.configUpdated({ ...BASE, host: '192.0.2.31' });
  const ack = await pressed;
  assert.equal(ack.success, false);
  assert.match(ack.error, /without confirmation/);
});

test('M8: a restart after a session that worked waits the keep-alive; one wake per 5 s', async (t) => {
  const store = memoryStore({ codeStop: null, lastAttemptAt: Date.now() - 2_000, failures: 0 });
  const ctx = await setup(t, { store });
  await settle();
  assert.equal(ctx.panel.sockets.length, 0);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /next try in 2\d s/);
  const fakeTimers = {
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  const client = new VisonicClient({
    connect: () => ({ on() {}, setNoDelay() {} }),
    timers: fakeTimers,
  });
  client.running = true;
  assert.equal(client.wake(), true);
  client.socket = undefined;
  assert.equal(client.wake(), false, 'a second wake within 5 s');
  client.running = false;
});

test('M9: a request is never written after its own deadline, even when its slot comes late', async () => {
  let now = 0;
  const timers = { setTimeout: () => 1, clearTimeout: () => undefined, setInterval: () => 1 };
  const writes = [];
  const client = new VisonicClient({ now: () => now, timers });
  client.socket = { write: (b) => writes.push(b), writableLength: 0 };
  client.ready = true;
  client.lastWriteAt = 0;
  const read = client.readStatus({ sendBy: 100 });
  // The slot comes at 190 ms (spacing), after its deadline.
  now = 190;
  client.outTimer = undefined;
  client.drain();
  await assert.rejects(read, (err) => err.kind === 'late');
  assert.equal(writes.length, 0);
});

test('M10: an alarm already in progress at start fires alarm_triggered', async (t) => {
  const ctx = await setup(t, {
    prepare: (panel) => {
      panel.sysStatus = SYS.ARMED_AWAY;
      panel.sysFlags = 0x81;
    },
  });
  await up(ctx);
  await flush(ctx);
  assert.deepEqual(
    ctx.events().map((e) => [e.key, e.data.kind]),
    [['alarm_triggered', 'intrusion']],
  );
});
