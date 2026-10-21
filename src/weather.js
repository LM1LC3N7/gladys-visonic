// -----------------------------------------------------------------------------
// Example "driver" for a REAL sensor, without hardware: the Open-Meteo API.
//
// This is where we talk to the outside world (a free public HTTP API, no key).
// In a real integration this file would be replaced by the call to your home
// automation gateway, your MQTT broker, your vendor cloud API, a serial port...
//
// Node 20+ provides `fetch` natively: no dependency needed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'weather' });

/**
 * Fetch the current temperature and humidity for a position.
 * @param {{ latitude: number, longitude: number, unit: string }} config
 * @returns {Promise<{ temperature: number, humidity: number }>}
 */
export async function fetchWeather({ latitude, longitude, unit }) {
  const temperatureUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}` +
    `&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m` +
    `&temperature_unit=${temperatureUnit}`;

  logger.debug('Open-Meteo request ->', url);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    // Propagate the error: the caller decides whether to re-publish the old
    // value or to mark the sensor as unreachable.
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const body = await response.json();
  const current = body.current ?? {};

  return {
    temperature: Number(current.temperature_2m),
    humidity: Number(current.relative_humidity_2m),
  };
}
