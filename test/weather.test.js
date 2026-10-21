import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeather } from '../src/weather.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('fetchWeather returns the parsed temperature and humidity', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ current: { temperature_2m: 21.4, relative_humidity_2m: 55 } }),
  });

  const result = await fetchWeather({ latitude: 48.8, longitude: 2.3, unit: 'celsius' });
  assert.deepEqual(result, { temperature: 21.4, humidity: 55 });
});

test('fetchWeather requests the fahrenheit unit when configured', async () => {
  let calledUrl;
  globalThis.fetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ current: {} }) };
  };

  await fetchWeather({ latitude: 1, longitude: 2, unit: 'fahrenheit' });
  assert.match(calledUrl, /temperature_unit=fahrenheit/);
});

test('fetchWeather throws on a non-2xx response', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  await assert.rejects(
    () => fetchWeather({ latitude: 1, longitude: 2, unit: 'celsius' }),
    /Open-Meteo HTTP 503/,
  );
});
