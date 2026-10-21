// -----------------------------------------------------------------------------
// Device type: DIMMABLE LIGHT
// Illustrates a device with SEVERAL controllable features: on/off + brightness.
// A single onSetValue callback handles the whole device and routes per feature.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'light';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here).
const PLATFORM_DEVICE_ID = 'bulb-4d9e01';

const FEATURE = {
  ON_OFF: 'on-off',
  BRIGHTNESS: 'brightness',
};

// In-memory reflection of the real device state.
let isOn = false;
let brightness = 50;

export const light = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Living room light',
      external_id: ids.device,
      features: [
        {
          name: 'On/Off',
          external_id: ids.feature(FEATURE.ON_OFF),
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
        {
          name: 'Brightness',
          external_id: ids.feature(FEATURE.BRIGHTNESS),
          category: DEVICE_FEATURE_CATEGORIES.LIGHT,
          type: DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
      ],
    };
  },

  // Used by the `identify` manifest action (see the dynamic device select in
  // gladys-assistant-integration.json): make THIS physical device signal
  // itself so the user can spot it among identical hardware.
  async identify() {
    logger.info('Identify: blinking the bulb');
    // ------------------------------------------------------------------ //
    // DO THE WORK: make the bulb blink without changing its final state.
    // e.g. await zigbee.set(ieeeAddr, { effect: 'blink' });
    // ------------------------------------------------------------------ //
  },

  async onSetValue(gladys, { feature, value }) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);

    if (feature.external_id === ids.feature(FEATURE.ON_OFF)) {
      const on = value === 1;
      logger.info(`Power: ${isOn ? 'ON' : 'OFF'} -> ${on ? 'ON' : 'OFF'}`);
      // -------------------------------------------------------------- //
      // DO THE WORK: turn the bulb on/off.
      // e.g. await zigbee.set(ieeeAddr, { state: on ? 'ON' : 'OFF' });
      // -------------------------------------------------------------- //
      isOn = on;
      await gladys.publishState(feature.external_id, on ? 1 : 0);
      return;
    }

    if (feature.external_id === ids.feature(FEATURE.BRIGHTNESS)) {
      const level = Math.max(0, Math.min(100, value));
      logger.info(`Brightness: ${brightness}% -> ${level}%`);
      // -------------------------------------------------------------- //
      // DO THE WORK: set the brightness (often needs converting to the
      // hardware scale, e.g. 0-254 for Zigbee).
      // e.g. await zigbee.set(ieeeAddr, { brightness: Math.round(level / 100 * 254) });
      // -------------------------------------------------------------- //
      brightness = level;
      isOn = level > 0;
      await gladys.publishState(feature.external_id, level);
      return;
    }

    logger.warn(`Unknown feature: ${feature.external_id}`);
  },
};
