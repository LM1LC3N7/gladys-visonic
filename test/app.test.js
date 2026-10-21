// VisonicApp with the SDK's fake Gladys (createFakeGladys) and the in-memory
// panel (test/helpers/fakeVisonic.js): the whole chain from the frames to the
// Gladys devices, states, scene events and commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { VisonicApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { FakePanel, SYS, quietLogger, settle, until } from './helpers/fakeVisonic.js';

const BASE = {
  host: '192.0.2.30',
  port: 10628,
  user_code: '1234',
  zones: '1, 2:motion, 5',
  language: 'en',
};

/** A clock that tests can move forward (the timers stay real). */
const clock = () => {
  let offset = 0;
  const now = () => Date.now() + offset;
  now.advance = (ms) => {
    offset += ms;
  };
  return now;
};

async function setup(
  t,
  { config = {}, panel: panelOptions = {}, store, devices, now, prepare } = {},
) {
  const gladys = createFakeGladys({ config: { ...BASE, ...config }, devices });
  const panel = new FakePanel(panelOptions);
  prepare?.(panel);
  const logger = quietLogger();
  const memory = store ?? memoryStore();
  const app = new VisonicApp({ gladys, logger, connect: panel.connect, store: memory, now });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop({ final: true }));
  const device = (externalId) =>
    gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  const panelIds = gladys.externalIds('panel', 'visonic');
  return {
    gladys,
    panel,
    app,
    logger,
    store: memory,
    device,
    panelIds,
    zone: (n) => gladys.externalIds('zone', String(n)),
    state: (id) => gladys.fake.lastState(id),
    events: () => gladys.fake.sceneEvents,
    press: (key, value = 1) => {
      const d = device(panelIds.device);
      const feature = d.features.find((f) => f.external_id === panelIds.feature(key));
      return gladys.fake.setValue(d, feature, value);
    },
  };
}

const up = async (ctx) => {
  await until(() => ctx.app.online);
  await ctx.app.chain;
  await settle();
};

/** Lets a change reported by the panel reach Gladys. */
const flush = async (ctx) => {
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ctx.app.chain;
  await settle();
};

const logs = (ctx) => ctx.logger.lines.join('\n');

/** The ack of a handler that succeeded. */
const ok = (ack) => assert.equal(ack?.success, true, ack?.error);

/** The ack of a handler that failed, its message matching. */
const fails = (ack, expected) => {
  assert.equal(ack?.success, false, 'the handler should have failed');
  if (typeof expected === 'function') assert.ok(expected(ack.error), ack.error);
  else if (expected) assert.match(ack.error, expected);
};

test('start: devices, read-only states, push buttons only, status, acknowledges', async (t) => {
  const ctx = await setup(t, { prepare: (panel) => panel.zones.open.add(5) });
  await up(ctx);
  const { gladys, panelIds, zone } = ctx;
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [panelIds.device, 'Visonic panel'],
      [zone(1).device, 'Zone 1'],
      [zone(2).device, 'Zone 2'],
      [zone(5).device, 'Zone 5'],
    ],
  );
  for (const d of gladys.fake.discoveredDevices) {
    for (const f of d.features) {
      assert.notEqual(f.category, 'switch', `${f.external_id}: never a switch`);
      if (f.read_only === false) {
        assert.deepEqual([f.category, f.type], ['button', 'push'], `${f.external_id}: a button`);
      }
    }
  }
  assert.equal(ctx.device(zone(2).device).features[0].category, 'motion-sensor');
  assert.equal(ctx.state(panelIds.feature('mode')), 'Disarmed');
  assert.equal(ctx.state(panelIds.feature('online')), 1);
  assert.equal(ctx.state(panelIds.feature('ready')), 1);
  assert.equal(ctx.state(zone(1).feature('opening')), 1, 'opening: 1 = closed (core)');
  assert.equal(ctx.state(zone(5).feature('opening')), 0, 'open');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /Visonic panel \(disarmed\), 3 zone/);
  assert.ok(gladys.fake.transports.every((entry) => entry.transport === 'local'));
  // The first request asked every status message; each one was acknowledged.
  assert.deepEqual([...ctx.panel.statusRequests[0].data.subarray(0, 3)], [0, 0, 0x3f]);
  await until(() => ctx.panel.acks >= 5);
});

test('reports of the panel become states and scene events (never undefined)', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const { panel, panelIds, zone } = ctx;
  panel.zones.open.add(1);
  panel.pushMasks(0x02);
  await flush(ctx);
  assert.equal(ctx.state(zone(1).feature('opening')), 0);
  // A motion (zone event 5 of A5 04) is shown, the panel never sends its end.
  panel.push({ zone: 2, event: 5 });
  await flush(ctx);
  assert.equal(ctx.state(zone(2).feature('motion')), 1);
  // Armed from a keypad: exit delay first, then armed.
  panel.sysStatus = SYS.ARMING_AWAY;
  panel.push();
  await flush(ctx);
  assert.equal(ctx.state(panelIds.feature('mode')), 'Arming');
  assert.equal(ctx.events().length, 0, 'no event during the exit delay');
  panel.sysStatus = SYS.ARMED_AWAY;
  panel.push();
  await flush(ctx);
  assert.equal(ctx.state(panelIds.feature('armed')), 1);
  assert.deepEqual(ctx.events().at(-1), {
    key: 'armed',
    data: { mode: 'armed_away', by_gladys: false },
  });
  // An intrusion: the alarm flag while armed (pyvisonic's Standard mode rule).
  panel.sysFlags |= 0x80;
  panel.push();
  await flush(ctx);
  assert.equal(ctx.state(panelIds.feature('alarm')), 1);
  assert.deepEqual(ctx.events().at(-1), {
    key: 'alarm_triggered',
    data: { kind: 'intrusion', zone: null, fire: false },
  });
  // A fire (A7 event 0x20) with its zone.
  panel.events([[9, 0x20]]);
  await flush(ctx);
  assert.equal(ctx.state(panelIds.feature('fire-alarm')), 1);
  assert.equal(ctx.events().at(-1).data.kind, 'fire');
  assert.equal(ctx.events().at(-1).data.fire, true);
  for (const event of ctx.events()) {
    for (const value of Object.values(event.data)) {
      assert.notEqual(value, undefined);
      assert.ok(!Number.isNaN(value));
    }
  }
  panel.sysStatus = SYS.DISARMED;
  panel.sysFlags = 0x01;
  panel.push();
  panel.events([[0, 0x21]]);
  await flush(ctx);
  assert.equal(ctx.state(panelIds.feature('alarm')), 0);
  assert.deepEqual(ctx.events().at(-1), { key: 'disarmed', data: { by_gladys: false } });
});

test('arm away: always allowed, decided on the state read now, confirmed by it', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const reads = ctx.panel.statusRequests.length;
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.commands.length, 1);
  const frame = ctx.panel.commands[0].data;
  assert.deepEqual([...frame.subarray(2, 6)], [0x05, 0x12, 0x34, 0x07]);
  assert.ok(ctx.panel.statusRequests.length >= reads + 2, 'a read before, a read after');
  await flush(ctx);
  assert.deepEqual(ctx.events().at(-1), {
    key: 'armed',
    data: { mode: 'armed_away', by_gladys: true },
  });
  // Already armed away: nothing sent.
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.commands.length, 1);
  assert.doesNotMatch(logs(ctx), /1234/, 'the code is never logged');
});

test('arm with an exit delay: the arming state confirms it', async (t) => {
  const ctx = await setup(t, { panel: { exitDelay: true } });
  await up(ctx);
  ok(await ctx.gladys.fake.sceneAction('arm', { mode: 'armed_stay' }));
  assert.equal(ctx.panel.commands.length, 1);
  assert.equal(ctx.panel.commands[0].data[2], 0x04);
  fails(await ctx.gladys.fake.sceneAction('arm', { mode: 'armed_night' }));
  fails(await ctx.gladys.fake.sceneAction('arm', {}));
  assert.equal(ctx.panel.commands.length, 1);
});

test('arm is protective: sent even when the state cannot be read', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  let holdReads = true;
  ctx.panel.hold = (type) => holdReads && type === 0xa2;
  const pressed = ctx.press('arm-away');
  await until(() => ctx.panel.commands.length === 1, 4_000);
  holdReads = false;
  fails(await pressed, /Sent to the panel/);
});

test('disarm: off by default, nothing sent, nothing read', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  ctx.panel.push();
  await flush(ctx);
  const reads = ctx.panel.statusRequests.length;
  fails(await ctx.press('disarm'), /Disarming from Gladys is disabled/);
  fails(await ctx.gladys.fake.sceneAction('disarm', {}), /disabled/);
  assert.equal(ctx.panel.commands.length, 0);
  assert.equal(ctx.panel.statusRequests.length, reads);
  assert.match(logs(ctx), /Disarm REFUSED: disabled/);
});

test('disarm allowed: decided on the state read now, confirmed, credited to Gladys', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  // Disarmed already: nothing sent.
  ok(await ctx.press('disarm'));
  assert.equal(ctx.panel.commands.length, 0);
  // Armed from a keypad while the memory still says disarmed: the fresh read decides.
  ctx.panel.sysStatus = SYS.ARMED_STAY;
  ok(await ctx.press('disarm'));
  assert.equal(ctx.panel.commands.length, 1);
  assert.equal(ctx.panel.commands[0].data[2], 0x00);
  await flush(ctx);
  assert.equal(ctx.state(ctx.panelIds.feature('mode')), 'Disarmed');
});

test('disarm: the option switched off while it waits for its read is never sent', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  ctx.panel.hold = (type, data) => {
    if (type !== 0xa2 || data[2] !== 0x08) return false;
    gate.then(() => ctx.panel.receive(ctx.panel.current, { type: 0xa2, data: Buffer.from(data) }));
    ctx.panel.hold = () => false;
    return true;
  };
  const pressed = ctx.press('disarm');
  await settle();
  await ctx.app.configUpdated({ ...BASE, allow_disarm: false });
  release();
  fails(await pressed, /disabled/);
  assert.equal(ctx.panel.commands.length, 0);
});

test('an arm withdraws a disarm still waiting its turn', async (t) => {
  const ctx = await setup(t, { config: { allow_disarm: true } });
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  ctx.panel.push();
  await flush(ctx);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  // The first disarm's read is held: the second disarm waits behind it.
  ctx.panel.hold = (type, data) => {
    if (type !== 0xa2) return false;
    ctx.panel.hold = () => false;
    gate.then(() => ctx.panel.receive(ctx.panel.current, { type: 0xa2, data: Buffer.from(data) }));
    return true;
  };
  const first = ctx.press('disarm');
  const second = ctx.press('disarm');
  await settle();
  const arm = ctx.press('arm-stay');
  release();
  fails(await first, /An arming was asked/);
  fails(await second, /An arming was asked/);
  ok(await arm);
  assert.deepEqual(
    ctx.panel.commands.map((c) => c.data[2]),
    [],
    'armed away already: the arm stay changed nothing',
  );
  assert.match(logs(ctx), /Disarm WITHDRAWN/);
});

test('a refused code stops the commands, across restarts, until a click or a new code', async (t) => {
  const store = memoryStore();
  const ctx = await setup(t, { config: { user_code: '9999' }, store });
  await up(ctx);
  fails(await ctx.press('arm-away'), /refused the user code/);
  assert.equal(ctx.panel.commands.length, 1);
  assert.ok(store.data.codeStop, 'persisted');
  assert.doesNotMatch(JSON.stringify(store.data), /9999/, 'never the code in /data');
  await flush(ctx);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /refused the user code/);
  fails(await ctx.press('arm-away'), /refused this user code before/);
  assert.equal(ctx.panel.commands.length, 1, 'never sent again by itself');

  // A restart (same code) keeps the stop.
  const again = await setup(t, { config: { user_code: '9999' }, store });
  await up(again);
  fails(await again.press('arm-away'), /refused this user code before/);
  assert.equal(again.panel.commands.length, 0);
  // The click lifts it: one new try.
  const message = await again.gladys.fake.action('allow_code_retry');
  ok(message);
  assert.match(JSON.stringify(message), /Nothing was sent now/);
  fails(await again.press('arm-away'), /refused the user code/);
  assert.equal(again.panel.commands.length, 1);
  // A new code lifts it too.
  await again.app.configUpdated({ ...BASE, user_code: '1234' });
  ok(await again.press('arm-away'));
  assert.equal(again.panel.commands.length, 2);
});

test('no answer: "sent, without confirmation", and a late denial still stops the code', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.hold = (type) => type === 0xa1;
  fails(await ctx.press('arm-away'), /Sent to the panel \(arm away\), without confirmation/);
  ctx.panel.current.send([0x08]);
  await flush(ctx);
  assert.ok(ctx.store.data?.codeStop, 'the late denial stopped the code');
});

test('acknowledged but the state does not follow: never reported as done', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.ignoreCommands = true;
  fails(await ctx.press('arm-away'), /does not show it yet/);
  assert.equal(ctx.panel.commands.length, 1);
});

test('a command is never written after its deadline', async (t) => {
  const now = clock();
  const ctx = await setup(t, { config: { allow_disarm: true }, now });
  await up(ctx);
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  ctx.panel.hold = (type, data) => {
    if (type !== 0xa2) return false;
    // The read answers, but 3.6 s after the request.
    ctx.panel.hold = () => false;
    now.advance(3_600);
    ctx.panel.receive(ctx.panel.current, { type: 0xa2, data: Buffer.from(data) });
    return true;
  };
  fails(await ctx.press('disarm'), /too slowly|answered too/);
  assert.equal(ctx.panel.commands.length, 0);
});

test('the acknowledge of a status request never passes for the command one', async (t) => {
  const ctx = await setup(t, { panel: { ackLast: true } });
  await up(ctx);
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.commands.length, 1);
  await flush(ctx);
  assert.equal(ctx.state(ctx.panelIds.feature('mode')), 'Armed (away)');
});

test('restart loop: never a connection sooner than the last attempt allows', async (t) => {
  const store = memoryStore({ codeStop: null, lastAttemptAt: Date.now() - 1_000, failures: 2 });
  const ctx = await setup(t, { store });
  await settle();
  assert.equal(ctx.panel.sockets.length, 0, 'waits ~30 s after two failures');
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /next try in (29|30) s/);
  // The test button does not connect sooner, and sends nothing.
  fails(await ctx.gladys.fake.action('test_connection'), /next try in/);
  assert.equal(ctx.panel.sockets.length, 0);
});

test('an arm is never blocked by the waits between attempts: one attempt now', async (t) => {
  const store = memoryStore({ codeStop: null, lastAttemptAt: Date.now() - 1_000, failures: 4 });
  const ctx = await setup(t, { store, config: { allow_disarm: true } });
  await settle();
  assert.equal(ctx.panel.sockets.length, 0);
  // A disarm waits its turn like any read: refused, nothing sent, no connection.
  fails(await ctx.press('disarm'), /not connected/);
  assert.equal(ctx.panel.sockets.length, 0);
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.sockets.length, 1, 'one attempt, one socket');
  assert.equal(ctx.panel.commands.length, 1);
  assert.match(logs(ctx), /one connection attempt now/);
});

test('attempts are written to /data at most once a minute', async (t) => {
  const store = memoryStore();
  const ctx = await setup(t, { store, panel: { refuseConnections: 3 } });
  await until(() => ctx.panel.sockets.length >= 1);
  await settle();
  const saves = store.saves;
  assert.ok(store.data.lastAttemptAt > 0);
  ctx.app.noteAttempt(Date.now());
  ctx.app.noteAttempt(Date.now());
  assert.equal(store.saves, saves);
});

test('Gladys reconnects: status, devices and states again, the panel is not read', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const sockets = ctx.panel.sockets.length;
  const reads = ctx.panel.statusRequests.length;
  const published = ctx.gladys.fake.discoveredDevices;
  await ctx.app.connected({ ...BASE });
  await ctx.app.connected({ ...BASE });
  assert.equal(ctx.panel.sockets.length, sockets);
  assert.equal(ctx.panel.statusRequests.length, reads);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, published.length);
  // The same configuration saved again: no reconnection either.
  await ctx.app.configUpdated({ ...BASE });
  assert.equal(ctx.panel.sockets.length, sockets);
  // Test the connection: tells, sends nothing.
  ok(await ctx.gladys.fake.action('test_connection'));
  assert.equal(ctx.panel.statusRequests.length, reads);
  // Discovery: published again, nothing read.
  await ctx.gladys.fake.scanRequest();
  assert.equal(ctx.panel.statusRequests.length, reads);
});

test('a new address: the old session publishes nothing more', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  const old = ctx.panel.current;
  await ctx.app.configUpdated({ ...BASE, host: '192.0.2.31' });
  ctx.panel.sysStatus = SYS.ARMED_AWAY;
  old.send(ctx.panel.system());
  await flush(ctx);
  assert.notEqual(ctx.state(ctx.panelIds.feature('mode')), 'Armed (away)');
});

test('a link lost: offline states, unreachable transports, spaced reconnection', async (t) => {
  const ctx = await setup(t);
  await up(ctx);
  ctx.panel.drop();
  await until(() => !ctx.app.online);
  await flush(ctx);
  assert.equal(ctx.state(ctx.panelIds.feature('online')), 0);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /next try in 10 s/);
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, 'unreachable');
  // An arm does not wait for the next try: one attempt now.
  const sockets = ctx.panel.sockets.length;
  ok(await ctx.press('arm-away'));
  assert.equal(ctx.panel.sockets.length, sockets + 1);
});

test('a silent adapter: told, never a busy loop', async (t) => {
  const ctx = await setup(t, { panel: { silent: true } });
  await until(() => ctx.panel.statusRequests.length >= 1);
  assert.equal(ctx.panel.sockets.length, 1);
});
