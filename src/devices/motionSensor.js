// -----------------------------------------------------------------------------
// Device type: MOTION SENSOR
// Illustrates a PUSH (event-driven) sensor: there is no polling, the device
// pushes its state whenever it changes. We subscribe once on connection.
//
// It also illustrates a SCENE TRIGGER (SDK v0.14+, Gladys 5.1+): on top of its
// binary state, every detection fires the `motion_detected` trigger declared
// in the manifest `scene_triggers` field. State vs event: the state ("there is
// motion", 0/1) stays a device feature published with `publishState` — it
// already drives the standard "device state" scene trigger. The event says
// "this happened, with these details": this demo sensor (think radar or
// camera-based) tells WHAT moved, a detail a binary state cannot carry.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'motion-sensor';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here).
const PLATFORM_DEVICE_ID = 'motion-e2b0f9';

const FEATURE = { MOTION: 'motion' };

// Scene trigger key, as declared in the manifest `scene_triggers` field. Keys
// are forever: scenes store it, so a published key is never renamed.
export const MOTION_DETECTED_TRIGGER = 'motion_detected';

// What the simulated sensor can tell apart: the `options` of the trigger's
// `target` filter in the manifest.
const TARGETS = ['person', 'animal'];

export const motionSensor = {
  key: DEVICE_TYPE,

  // Scene triggers this device fires (checked against the manifest by the tests).
  sceneTriggers: [MOTION_DETECTED_TRIGGER],

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Entrance motion sensor',
      external_id: ids.device,
      features: [
        {
          name: 'Motion',
          external_id: ids.feature(FEATURE.MOTION),
          category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
      ],
    };
  },

  // No onPoll: this sensor is event-driven. We subscribe once on connection and
  // publish the state whenever it changes.
  startPush(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    logger.info('Subscribing to the motion stream...');

    // ------------------------------------------------------------------ //
    // DO THE WORK: subscribe to your hardware real-time stream.
    // e.g. let motionBefore = false;
    //      mqttClient.on('message', async (topic, payload) => {
    //        if (topic !== 'entrance/motion') return;
    //        // e.g. {"motion": true, "target": "person"}
    //        const { motion, target } = JSON.parse(payload);
    //        // A scene event on the 0 -> 1 EDGE only: a retained or repeated
    //        // `motion: true` frame is not a new detection (300 events/min).
    //        const isNewDetection = motion && !motionBefore;
    //        motionBefore = motion;
    //        await gladys.publishState(ids.feature(FEATURE.MOTION), motion ? 1 : 0);
    //        if (isNewDetection) {
    //          await gladys.publishSceneEvent(MOTION_DETECTED_TRIGGER,
    //                                         { device: ids.device, target });
    //        }
    //      });
    //
    // Here we SIMULATE a detection followed by a clear, every ~60 s.
    // ------------------------------------------------------------------ //
    const interval = setInterval(async () => {
      const target = TARGETS[Math.floor(Math.random() * TARGETS.length)];
      try {
        logger.info(`Motion detected (${target}) -> 1`);
        await gladys.publishState(ids.feature(FEATURE.MOTION), 1);
        // Clear the detection after 10 s.
        setTimeout(() => {
          gladys
            .publishState(ids.feature(FEATURE.MOTION), 0)
            .catch((e) => logger.error('publishState 0 failed', e));
        }, 10_000);

        // One event per TRANSITION (0 -> 1), never one per frame nor on the
        // clear: the core admits 300 events/minute per integration. `data` is
        // flat (≤ 30 primitive keys); only the keys declared in the trigger's
        // `fields` (the filters: `device`, `target`) and `variables` (exposed
        // to the scene as {{triggerEvent.data.target}}) are kept. `device`
        // is the device external_id, the value a `"source": "devices"` filter
        // stores. A resolved call means "accepted", never "a scene ran".
        await gladys.publishSceneEvent(MOTION_DETECTED_TRIGGER, { device: ids.device, target });
      } catch (e) {
        logger.error('Motion detection publication failed', e);
      }
    }, 60_000);

    // Return a cleanup function, called on disconnection.
    return () => clearInterval(interval);
  },
};
