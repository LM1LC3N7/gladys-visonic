// -----------------------------------------------------------------------------
// Device type: SWITCH
// Illustrates a simple binary ON/OFF actuator.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'switch';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here). External ids
// must be globally unique and stable across restarts: they are how Gladys
// matches states to devices. `gladys.externalIds()` builds them for you.
const PLATFORM_DEVICE_ID = 'sw-8a3f2c';

const FEATURE = { ON_OFF: 'on-off' };

// In-memory reflection of the device state. In a real integration this IS the
// state of your physical device: you read/write it, you do not simulate it.
let isOn = false;

export const switchDevice = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Living room switch',
      external_id: ids.device,
      features: [
        {
          name: 'On/Off',
          external_id: ids.feature(FEATURE.ON_OFF),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          read_only: false, // actuator: the user can control it
          has_feedback: true, // the device confirms its new state
          keep_history: true,
        },
      ],
    };
  },

  async onSetValue(gladys, { feature, value }) {
    const on = value === 1;
    logger.info(`Command received: ${isOn ? 'ON' : 'OFF'} -> ${on ? 'ON' : 'OFF'}`);

    // ------------------------------------------------------------------ //
    // DO THE WORK: send the order to the real relay / plug.
    // e.g. await mqttClient.publish('living-room/switch/set', on ? 'ON' : 'OFF');
    //      await cloudApi.setSwitch(PLATFORM_DEVICE_ID, on);
    // If the device does not answer, `throw`: the SDK then sends a
    // success:false acknowledgement to Gladys and the UI shows the failure.
    // ------------------------------------------------------------------ //
    isOn = on;

    // has_feedback = true -> publish the state confirmed by the device.
    // With a real feedback device you would publish the state reported in its
    // confirmation message, not the value you just requested.
    await gladys.publishState(feature.external_id, on ? 1 : 0);
  },
};
