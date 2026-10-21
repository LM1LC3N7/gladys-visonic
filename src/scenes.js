// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// A scene action is an OPERATION a scene author places in a scene, with
// parameters and a result: "identify this device", "take a snapshot", "clean
// these rooms". Each one is declared in the manifest `scene_actions` field
// (key, label, `fields` in the config_schema grammar, scalar `outputs`) and
// handled here, keyed by that same `key`; index.js registers every entry with
// `gladys.onSceneAction(key, ...)`.
//
// Scene TRIGGERS are the other direction ("this happened"): they are fired by
// the device that observes the event, see src/devices/motionSensor.js.
//
// The rules that matter:
//   - `fields` arrive RESOLVED: scene variables substituted, defaults applied,
//     validated by the core; a `"source": "devices"` field is the chosen
//     device external_id;
//   - resolve an object of the declared `outputs` (scalars only), readable by
//     the following actions of the scene, or `undefined` for none. Keys not
//     declared in the manifest are dropped by the core;
//   - throwing fails THIS action only: the scene logs it and continues. A
//     scene action is never a condition: return an output and let the scene
//     author gate on it;
//   - never fire a scene event as a consequence of a received action: a scene
//     bound to that event would loop through the integration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { signalDevice } from './devices/index.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  // The ack is awaited under the action's `timeout_seconds` (15 s in the
  // manifest), counted from the moment the scene reaches the action.
  async identify_device(gladys, { fields, config }) {
    logger.info(`Scene action identify_device <- ${fields.device}`);
    const signalled = await signalDevice(gladys, fields.device, config);
    return { signalled };
  },
};
