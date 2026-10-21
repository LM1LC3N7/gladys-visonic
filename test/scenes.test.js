import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { MOTION_DETECTED_TRIGGER, motionSensor } from '../src/devices/motionSensor.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { normalizeConfig } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const config = normalizeConfig();

const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const deviceIdOf = (gladys, key) =>
  DEVICE_BLUEPRINTS.find((bp) => bp.key === key).deviceExternalId(gladys);

// Let the async interval callback run to completion.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the motion sensor fires one motion_detected event per detection, none on the clear', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const gladys = createFakeGladys();
  const stopPush = motionSensor.startPush(gladys, config);
  try {
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(gladys.fake.sceneEvents.length, 1, 'one detection, one event');
    assert.equal(gladys.fake.sceneEvents[0].key, MOTION_DETECTED_TRIGGER);
    assert.equal(gladys.fake.states.at(-1).state, 1, 'the state is still published');

    t.mock.timers.tick(10_000);
    await flush();
    assert.equal(gladys.fake.states.at(-1).state, 0, 'the detection is cleared');
    assert.equal(gladys.fake.sceneEvents.length, 1, 'the clear fires no event');
  } finally {
    stopPush();
  }
});

test('motion_detected data only carries keys the trigger declares', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const gladys = createFakeGladys();
  const stopPush = motionSensor.startPush(gladys, config);
  try {
    t.mock.timers.tick(60_000);
    await flush();
  } finally {
    stopPush();
  }
  const [{ data }] = gladys.fake.sceneEvents;
  const trigger = declarationOf('scene_triggers', MOTION_DETECTED_TRIGGER);
  // The core keeps the `fields` keys (filters) and the `variables` keys
  // (exposed to the scene): any other key would be silently dropped.
  const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
  for (const [key, value] of Object.entries(data)) {
    assert.ok(declared.includes(key), `data.${key} is not declared, the core would drop it`);
    assert.ok(value === null || typeof value !== 'object', `data.${key} must be a primitive`);
  }
  // A `"source": "devices"` filter stores a device external_id.
  assert.equal(data.device, deviceIdOf(gladys, 'motion-sensor'));
  const targets = trigger.fields.find((field) => field.key === 'target').options;
  assert.ok(
    targets.some((option) => option.value === data.target),
    `data.target "${data.target}" must be one of the filter options`,
  );
});

test('identify_device signals the chosen device and returns the declared outputs', async () => {
  const gladys = createFakeGladys();
  const outputs = await SCENE_ACTIONS.identify_device(gladys, {
    fields: { device: deviceIdOf(gladys, 'light') },
    config,
  });
  assert.deepEqual(outputs, { signalled: true });
  const declared = keysOf(declarationOf('scene_actions', 'identify_device').outputs);
  for (const key of Object.keys(outputs)) {
    assert.ok(declared.includes(key), `output "${key}" is not declared, the core would drop it`);
  }
});

test('identify_device reports a device that cannot signal itself through its output', async () => {
  // Not a failure: a scene action is never a condition, the scene author
  // gates the following actions on the output instead.
  const gladys = createFakeGladys();
  const outputs = await SCENE_ACTIONS.identify_device(gladys, {
    fields: { device: deviceIdOf(gladys, 'weather-station') },
    config,
  });
  assert.deepEqual(outputs, { signalled: false });
});
