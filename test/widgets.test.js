import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDiscoveredDevices } from '../src/devices/index.js';
import { simulateLanSession } from '../src/devices/plug.js';
import { DEMO_STATUS_WIDGET, WIDGETS, refreshWidgets } from '../src/widgets.js';
import { normalizeConfig } from '../src/config.js';

const gladys = createFakeGladys();
const config = normalizeConfig();
const demoStatus = WIDGETS[DEMO_STATUS_WIDGET];

// What the SDK passes to onWidgetGet, plus the config index.js adds.
const getContent = (cfg = config) =>
  demoStatus.get(gladys, { settings: {}, language: 'en', units: 'metric', config: cfg });

test('the demo_status content is rendered exactly as sent', async () => {
  // [] = nothing the core would drop, truncate or trim to the content budget.
  assert.deepEqual(validateWidgetContent(await getContent()), []);
});

test('the degraded plug connection content is valid too', async () => {
  simulateLanSession(false);
  try {
    const content = await getContent();
    assert.deepEqual(validateWidgetContent(content), []);
    const status = content.components.find((component) => component.type === 'status');
    assert.ok(
      status.items.some((item) => item.color === 'warning'),
      'degraded shows a warning',
    );
  } finally {
    simulateLanSession(true);
  }
});

test('the live tiles reference features the integration publishes', async () => {
  const featureIds = new Set(
    buildDiscoveredDevices(gladys, config).flatMap((device) =>
      device.features.map((feature) => feature.external_id),
    ),
  );
  const liveTiles = (await getContent()).components.filter((c) => c.device_feature);
  assert.ok(liveTiles.length > 0, 'the template demonstrates a device-bound tile');
  for (const tile of liveTiles) {
    assert.ok(featureIds.has(tile.device_feature), `unknown feature ${tile.device_feature}`);
  }
});

test('every button action of the content is handled and answers a short toast', async () => {
  const buttons = (await getContent()).components.filter((c) => c.type === 'button' && c.action);
  assert.ok(buttons.length > 0, 'the template demonstrates a widget action');
  for (const { action } of buttons) {
    const message = await demoStatus.action(gladys, {
      actionKey: action.key,
      params: action.params ?? {},
      settings: {},
      config,
    });
    assert.ok(message.en, 'the toast carries at least the mandatory `en` text');
    assert.ok(message.en.length <= 200, 'toasts are capped at 200 characters');
  }
});

test('an unknown widget action fails, so the user sees the error', async () => {
  await assert.rejects(
    demoStatus.action(gladys, { actionKey: 'unknown', params: {}, settings: {}, config }),
    /Unknown widget action/,
  );
});

test('refreshWidgets nudges every widget', () => {
  const fresh = createFakeGladys();
  refreshWidgets(fresh);
  assert.deepEqual(fresh.fake.widgetRefreshes, Object.keys(WIDGETS));
});
