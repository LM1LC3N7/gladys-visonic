// The configuration, normalized; the memory of /data, repaired; the state
// budget, shared by simultaneous publications.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost, parseZones, sessionKey } from '../src/config.js';
import { StatePublisher } from '../src/publisher.js';
import { normalizeMemory } from '../src/store.js';

test('address, port, code, zones, option, language', () => {
  assert.deepEqual(parseHost('tcp://192.168.1.70:10628/x'), { host: '192.168.1.70', port: 10628 });
  assert.deepEqual(parseHost('[fe80::1]:23'), { host: 'fe80::1', port: 23 });
  assert.deepEqual(parseHost('bad host'), { host: '' });
  const config = normalizeConfig({
    host: 'adapter.lan',
    port: '23',
    user_code: ' 1234 ',
    zones: '1-3, 7:motion; 9=smoke, 40, 2:door',
    allow_disarm: 'true',
    language: 'EN',
  });
  assert.equal(config.host, 'adapter.lan');
  assert.equal(config.port, 23);
  assert.equal(config.code, '1234');
  assert.deepEqual(
    [...config.zones.entries()],
    [
      [1, undefined],
      [2, undefined],
      [3, undefined],
      [7, 'motion'],
      [9, 'smoke'],
    ],
  );
  assert.deepEqual(config.zoneErrors, ['40', '2:door']);
  assert.equal(config.allowDisarm, false, 'only a real true allows disarming');
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ user_code: '12345' }).codeInvalid, true);
  assert.equal(normalizeConfig({ user_code: '12345' }).code, '');
  assert.equal(normalizeConfig({ port: '' }).port, undefined);
  assert.equal(normalizeConfig({ port: 70000 }).port, undefined);
  assert.equal(normalizeConfig({ host: '10.0.0.2:99', port: 23 }).port, 99);
  // Neither the code nor the zones reconnect.
  assert.equal(
    sessionKey(normalizeConfig({ host: 'a', port: 1, user_code: '1111', zones: '1' })),
    sessionKey(normalizeConfig({ host: 'a', port: 1, user_code: '2222', zones: '2' })),
  );
  assert.equal(parseZones('x'.repeat(10_000)).errors.length, 1, 'bounded');
});

test('the memory of /data: repaired, capped, a doubt keeps the stop', () => {
  const now = 1_000_000;
  assert.deepEqual(normalizeMemory(null, now), { codeStop: null, lastAttemptAt: 0, failures: 0 });
  assert.deepEqual(normalizeMemory({ codeStop: { at: 'x' } }, now).codeStop, { at: 0 });
  assert.equal(normalizeMemory({ lastAttemptAt: now * 2 }, now).lastAttemptAt, now);
  assert.equal(normalizeMemory({ failures: 1e9 }, now).failures, 20);
  assert.equal(normalizeMemory({ __proto__: { codeStop: { at: 1 } } }, now).codeStop, null);
});

test('the state budget holds with simultaneous publications', async () => {
  let sent = 0;
  const gladys = {
    publishStates: async (states) => {
      sent += states.length;
    },
  };
  const timers = { setTimeout: () => 0, clearTimeout: () => undefined };
  const publisher = new StatePublisher({ gladys, logger: console, timers });
  const batch = (prefix) =>
    Array.from({ length: 200 }, (_, i) => ({
      device_feature_external_id: `ext:x:${prefix}:${i}:state`,
      state: 1,
    }));
  await Promise.all([publisher.publish(batch('zone')), publisher.publish(batch('panel'))]);
  assert.ok(sent <= 240, `${sent} states in one minute`);
});
