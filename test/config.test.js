import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({ latitude: 45.5, longitude: -73.6, unit: 'fahrenheit' });
  assert.equal(config.latitude, 45.5);
  assert.equal(config.longitude, -73.6);
  assert.equal(config.unit, 'fahrenheit');
});

test('normalizeConfig coerces numeric strings coming from a form', () => {
  const config = normalizeConfig({ latitude: '48.8', longitude: '2.3', poll_frequency: '600' });
  assert.equal(config.latitude, 48.8);
  assert.equal(config.longitude, 2.3);
  assert.equal(config.poll_frequency, 600);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('normalizeConfig falls back to the default for a missing numeric field', () => {
  const config = normalizeConfig({ unit: 'celsius' });
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
});

test('GLADYS_PREFER_LOCAL defaults to true and only an explicit false disables it', () => {
  assert.equal(normalizeConfig().GLADYS_PREFER_LOCAL, true);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: true }).GLADYS_PREFER_LOCAL, true);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).GLADYS_PREFER_LOCAL, false);
});
