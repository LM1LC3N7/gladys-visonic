// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  latitude: 48.8566, // Paris
  longitude: 2.3522,
  unit: 'celsius', // 'celsius' | 'fahrenheit'
  // Seconds between two reads of the polled sensors. Gladys polls at most once
  // a minute: slower intervals are applied by skipping polls (see
  // createPoller in src/devices/index.js).
  poll_frequency: 300,
  // Reserved key (NOT in config_schema): because the manifest declares both
  // 'local' and 'cloud' in its `transports` field, Gladys shows a standard
  // "Prefer the local connection" toggle and sends the user's choice here.
  // Read-only for the integration; defaults to true.
  GLADYS_PREFER_LOCAL: true,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // Force the types: config may arrive as strings from a form.
    latitude: Number(raw.latitude ?? DEFAULT_CONFIG.latitude),
    longitude: Number(raw.longitude ?? DEFAULT_CONFIG.longitude),
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
  };
}
