// -----------------------------------------------------------------------------
// Device registry.
//
// Add or remove device types here. Each device lives in its own file and
// exposes the same shape:
//   - key                        : short identifier (used in logs)
//   - deviceExternalId(gladys)   : the device external_id (for dispatch)
//   - buildDevice(gladys, config): the discovery payload sent to Gladys
//   - onPoll(gladys, config)      (optional): periodic read, for a device
//     published with `should_poll: true` (see createPoller below)
//   - onSetValue(gladys, {...})   (optional): run a user command
//   - onGetImage(gladys, {...})   (optional): fresh camera capture, resolved
//     as an `image/jpg;base64,...` string (cameras only)
//   - startPush(gladys, config)   (optional): subscribe to a real-time stream
//   - transport(gladys, config)   (optional): effective transport of the
//     device, shown as a badge in Gladys. Either a plain string ('local' |
//     'cloud' | 'unreachable') or an object `{ transport, degraded, message }`
//     to also flag the "works, but not nominal" state (orange dot + tooltip)
//   - identify(gladys, {...})     (optional): make the physical device signal
//     itself (blink...), used by the `identify` manifest action
//   - actions                     (optional): manifest action handlers, keyed
//     by the action `key` declared in gladys-assistant-integration.json
//   - sceneTriggers               (optional): keys of the manifest
//     `scene_triggers` the device fires with `gladys.publishSceneEvent`
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { weatherStation } from './weatherStation.js';
import { switchDevice } from './switchDevice.js';
import { light } from './light.js';
import { plug } from './plug.js';
import { motionSensor } from './motionSensor.js';
import { camera } from './camera.js';

export const DEVICE_BLUEPRINTS = [weatherStation, switchDevice, light, plug, motionSensor, camera];

// Every scene trigger key the devices fire: each one must be declared in the
// manifest `scene_triggers` field, or the core answers 404 (see the tests).
export const SCENE_TRIGGER_KEYS = DEVICE_BLUEPRINTS.flatMap((bp) => bp.sceneTriggers ?? []);

/**
 * Build the discovery payload for Gladys (all devices).
 */
export function buildDiscoveredDevices(gladys, config) {
  return DEVICE_BLUEPRINTS.map((bp) => bp.buildDevice(gladys, config));
}

/**
 * Find the blueprint that owns a given device, from its external_id
 * (used to route onPoll / onSetValue / onGetImage to the right device).
 */
export function findBlueprintByDevice(gladys, device) {
  return DEVICE_BLUEPRINTS.find((bp) => bp.deviceExternalId(gladys) === device.external_id);
}

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 300 s interval does not slip to 360 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

/**
 * Create the `onPoll` dispatcher: route the poll to the owner blueprint, at
 * the refresh interval the user chose (`poll_frequency` config, in seconds).
 *
 * Gladys polls a device at a fixed pace, read once when the device is
 * created and at most once a minute (DEVICE_POLL_FREQUENCIES). The polled
 * devices declare that minute, and the slower interval of the config is
 * applied here by skipping the polls in between: the user can change it at
 * any time, without re-creating the devices.
 *
 * Resolves `true` when the device was read, `false` when the poll was
 * skipped. A read that throws is retried at the next poll.
 */
export function createPoller() {
  const lastReads = new Map();
  return async function pollDevice(gladys, device, config) {
    const blueprint = findBlueprintByDevice(gladys, device);
    if (!blueprint || typeof blueprint.onPoll !== 'function') {
      return false;
    }
    const now = Date.now();
    const lastRead = lastReads.get(device.external_id);
    if (
      lastRead !== undefined &&
      now - lastRead < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    await blueprint.onPoll(gladys, config);
    lastReads.set(device.external_id, now);
    return true;
  };
}

/**
 * Build the `publishTransports` payload: one entry per blueprint that reports
 * its effective transport (dual-channel devices). Devices with a single,
 * obvious channel simply do not implement `transport()`.
 *
 * A blueprint returns either a plain transport string, or an object
 * `{ transport, degraded, message }` when it needs to flag a degraded state
 * (SDK v0.7+): "it works, but not in the nominal mode" — e.g. local preferred
 * but refused, falling back to cloud. Entries WITHOUT `degraded` clear a
 * previously published degraded state, so nominal blueprints have nothing
 * special to do.
 */
export function buildTransportEntries(gladys, config) {
  return DEVICE_BLUEPRINTS.filter((bp) => typeof bp.transport === 'function').map((bp) => {
    const reported = bp.transport(gladys, config);
    const entry = typeof reported === 'string' ? { transport: reported } : reported;
    return { external_id: bp.deviceExternalId(gladys), ...entry };
  });
}

/**
 * Make a device signal itself (blink...) so the user can spot it among
 * identical hardware. Resolves `false` when the device has no way to.
 *
 * Written once, reached from three surfaces: the `identify` manifest action
 * (Configuration screen), the `identify_device` scene action (src/scenes.js)
 * and the button of the `demo_status` dashboard widget (src/widgets.js).
 */
export async function signalDevice(gladys, externalId, config) {
  const blueprint = findBlueprintByDevice(gladys, { external_id: externalId });
  if (!blueprint || typeof blueprint.identify !== 'function') {
    return false;
  }
  await blueprint.identify(gladys, { config });
  return true;
}

/**
 * Handler of the `identify` manifest action: make the chosen device signal
 * itself, and say so under the button.
 *
 * `externalId` comes from the action's dynamic select (`"source": "devices"`
 * in the manifest): the Configuration screen populates the options with the
 * integration's OWN created devices (label = device name, value =
 * external_id), so the user never copies an identifier by hand.
 */
export async function identifyDevice(gladys, externalId, config) {
  if (!(await signalDevice(gladys, externalId, config))) {
    return {
      en: 'This device has no way to signal itself.',
      fr: 'Cet appareil ne peut pas se signaler.',
    };
  }
  return {
    en: 'Look around: the device is signalling itself.',
    fr: "Regardez autour de vous : l'appareil se signale.",
  };
}
