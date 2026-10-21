// -----------------------------------------------------------------------------
// Device type: SMART PLUG
// Illustrates a MIXED device: a binary actuator (relay) AND a read-only
// measurement (instantaneous power). It is both controlled and polled.
//
// It also illustrates the cloud/local TRANSPORT BADGE (SDK v0.5.0+): this demo
// plug is a dual-channel device (think Tuya cloud + LAN) and reports the
// transport it currently uses through `transport()`. The registry collects
// those values and index.js publishes them with `gladys.publishTransports()`;
// Gladys renders them as a badge on the device cards.
//
// Since SDK v0.7.0 a transport entry can also carry a DEGRADED state: "it
// works, but not in the nominal mode" — here, local preferred but the LAN
// session is refused, so the plug falls back to cloud. Without the flag the
// user would see a perfectly normal `cloud` badge and nothing would invite
// them to investigate; with it, the badge keeps its transport color plus an
// orange dot, and the tooltip shows the reason.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'plug';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here).
const PLATFORM_DEVICE_ID = 'plug-77c1ab';

const FEATURE = {
  ON_OFF: 'on-off',
  POWER: 'power',
};

const POWER_HEARTBEAT_MS = 30 * 60 * 1000;

// In-memory reflection of the real device state.
let isOn = false;

// Simulated state of the LAN session to the plug. In a real integration this
// would reflect your actual local socket/session (rotated local key, another
// client holding the connection...). Exported so the tests — and you, while
// experimenting — can simulate a local failure and see the degraded badge.
let lanSessionOk = true;
export function simulateLanSession(ok) {
  lanSessionOk = ok;
}

export const plug = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Office plug',
      external_id: ids.device,
      // Polled to refresh the power reading (see weatherStation.js).
      should_poll: true,
      poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
      features: [
        {
          name: 'On/Off',
          external_id: ids.feature(FEATURE.ON_OFF),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
        {
          name: 'Instantaneous power',
          external_id: ids.feature(FEATURE.POWER),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: 3680,
          read_only: true, // measurement: not controllable
          has_feedback: false,
          keep_history: true,
        },
      ],
    };
  },

  // Effective transport of THIS device right now. The manifest declares both
  // channels in its `transports` field, so the Configuration screen shows a
  // standard "Prefer the local connection" toggle; the user's choice arrives
  // as the reserved (read-only) config key GLADYS_PREFER_LOCAL. The
  // preference is a wish, not an order: report the channel you ACTUALLY use,
  // not the one the user asked for — and when you cannot honor it, say WHY
  // with the degraded flag instead of silently falling back.
  transport(gladys, config) {
    // ------------------------------------------------------------------ //
    // DO THE WORK: return the channel currently used to reach the device.
    // Here we simulate a device that honors the preference, unless the LAN
    // session is refused (flip `simulateLanSession(false)` to see it).
    // ------------------------------------------------------------------ //
    if (config.GLADYS_PREFER_LOCAL === false) {
      return { transport: DEVICE_TRANSPORTS.CLOUD };
    }
    if (lanSessionOk) {
      return { transport: DEVICE_TRANSPORTS.LOCAL };
    }
    // Local preferred but refused -> cloud fallback, flagged degraded. The
    // message (multi-language, `en` mandatory, ≤ 200 chars per language) is
    // shown in the badge tooltip. Publishing a later entry WITHOUT `degraded`
    // clears the state — back to nominal, no ghost orange dot.
    return {
      transport: DEVICE_TRANSPORTS.CLOUD,
      degraded: true,
      message: {
        en: 'Local session refused, falling back to cloud.',
        fr: 'Session locale refusée, bascule sur le cloud.',
      },
    };
  },

  async onSetValue(gladys, { feature, value }) {
    const on = value === 1;
    logger.info(`Relay command: ${on ? 'ON' : 'OFF'}`);
    // ------------------------------------------------------------------ //
    // DO THE WORK: toggle the plug relay.
    // ------------------------------------------------------------------ //
    isOn = on;
    await gladys.publishState(feature.external_id, on ? 1 : 0);
  },

  async onPoll(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    // ------------------------------------------------------------------ //
    // DO THE WORK: read the instantaneous power measured by the plug.
    // Here we simulate it: 0 W when off, ~120 W (+ noise) when on.
    // ------------------------------------------------------------------ //
    const power = isOn ? Math.round(120 + Math.random() * 15) : 0;
    logger.info(`Measured power: ${power} W`);
    // An idle plug reads 0 W poll after poll: publishChangedStates (SDK
    // v0.15) only sends a value that changed, which keeps a large fleet under
    // the 300 states/minute limit of the host API. The heartbeat re-sends an
    // unchanged value every 30 minutes, so it stays recently dated in Gladys.
    await gladys.publishChangedStates(
      [{ device_feature_external_id: ids.feature(FEATURE.POWER), state: power }],
      { heartbeat: POWER_HEARTBEAT_MS },
    );
  },
};
