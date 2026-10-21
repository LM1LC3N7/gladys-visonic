// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration.
//
// Role of this file: wire the SDK to the device catalog (src/devices/). It holds
// NO hardware logic: all the control "work" lives in the device modules. This
// file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects and publishes the discovered devices.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  buildTransportEntries,
  createPoller,
  findBlueprintByDevice,
  identifyDevice,
} from './src/devices/index.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets } from './src/widgets.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Cleanup functions for the "push" subscriptions (e.g. the motion sensor).
let pushCleanups = [];

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  const blueprint = findBlueprintByDevice(gladys, device);
  if (!blueprint || typeof blueprint.onSetValue !== 'function') {
    // Throw: the SDK sends a success:false acknowledgement to Gladys.
    throw new Error(`No command handler for ${device.external_id}`);
  }
  await blueprint.onSetValue(gladys, { device, feature, value, config });
});

// --- Camera: Gladys needs a FRESH image of a camera device -------------------
// Triggered by the dashboard live view or a chat intent. The resolved
// `image/jpg;base64,...` string (≤ 150 KB) is acked back to Gladys; the ack is
// awaited under 15 s (not the usual 5 s), so a real capture fits.
gladys.onGetImage(async (device) => {
  logger.info(`onGetImage <- ${device.external_id}`);
  const blueprint = findBlueprintByDevice(gladys, device);
  if (!blueprint || typeof blueprint.onGetImage !== 'function') {
    throw new Error(`No camera handler for ${device.external_id}`);
  }
  return blueprint.onGetImage(gladys, { device, config });
});

// --- Polling: Gladys asks to refresh a device --------------------------------
// Gladys polls the devices published with `should_poll: true` once a minute;
// the poller reads them at the interval the user chose in the config.
const pollDevice = createPoller();
gladys.onPoll(async (device) => {
  if (!(await pollDevice(gladys, device, config))) {
    logger.debug(`onPoll skipped (not due) for ${device.external_id}`);
  }
});

// --- Manifest actions: buttons in the Configuration screen -------------------
// Each action declared in the `actions` field of the manifest is registered
// per key; the message resolved by the handler is displayed under the button
// (the ack is awaited under the action's `timeout_seconds`, not the usual 5 s).
for (const blueprint of DEVICE_BLUEPRINTS) {
  for (const [actionKey, handler] of Object.entries(blueprint.actions ?? {})) {
    gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config }));
  }
}

// The `identify` action targets ONE device chosen by the user, so it is not
// owned by a single blueprint. Its manifest field declares
// `"source": "devices"` (SDK v0.7+): instead of static `options`, the
// Configuration screen fills the select with the integration's own created
// devices, and the handler receives the chosen external_id as a field value.
gladys.onAction('identify', (fields) => {
  logger.info(`Action identify <- ${fields.device}`);
  return identifyDevice(gladys, fields.device, config);
});

// --- Scene actions: operations a scene author placed in a scene -------------
// Each action declared in the `scene_actions` field of the manifest is
// registered per key (SDK v0.14+, Gladys 5.1+). The handler receives the
// RESOLVED fields and returns the declared outputs (see src/scenes.js). Scene
// TRIGGERS need no handler: the devices fire them with publishSceneEvent (see
// src/devices/motionSensor.js).
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, config }));
}

// --- Dashboard widgets -------------------------------------------------------
// Each widget declared in the `widgets` field of the manifest is registered
// per key (SDK v0.14+, Gladys 5.1+): Gladys pulls its content (ack awaited
// under 15 s) and relays the taps on its `button` actions (see src/widgets.js).
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, config }));
  if (typeof widget.action === 'function') {
    gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
      widget.action(gladys, { actionKey, params, settings, config }),
    );
  }
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Re-publish the devices: some properties (the temperature unit) depend on it.
  // publishDiscoveredDevices is idempotent (upsert by external_id).
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
  // The reserved GLADYS_PREFER_LOCAL key arrives here like any other key:
  // re-route the dual-channel devices, then reflect the ACTUAL outcome.
  await publishDeviceTransports();
  // The dashboard widget shows config-derived values (plug connection,
  // observed location): nudge it instead of waiting for its content TTL.
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle (connections, disconnections,
// reconnection attempts) under the `gladys-sdk` name: no need to log it again
// here, these handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) (Re)publish all devices as soon as we are connected.
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));

    // 3) Publish the per-device transport badge (cloud/local, dual-channel
    // devices only). Lightweight channel: on a live switch, call it again
    // without re-publishing the devices.
    await publishDeviceTransports();
    // The widget's computed rows (plug connection, observed location) follow
    // the config and the transports just re-published, and the nudges sent
    // while the socket was down were dropped: re-sync open dashboards too.
    refreshWidgets(gladys);

    // 4) Start the real-time subscriptions ("push" sensors, camera snapshots).
    stopPushSubscriptions();
    pushCleanups = DEVICE_BLUEPRINTS.filter((bp) => typeof bp.startPush === 'function').map((bp) =>
      bp.startPush(gladys, config),
    );

    // 5) Report the application-level status, shown in the Configuration
    // screen. Distinct from the container state machine: an integration can
    // be RUNNING and still disconnected from its third-party service.
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  stopPushSubscriptions();
});

// Publish the effective transport of every dual-channel device
// ('local' | 'cloud' | 'unreachable'), rendered as a badge in the Gladys UI.
// An entry can also flag a degraded state (`{ degraded: true, message }`,
// SDK v0.7+): the badge keeps its transport color plus an orange dot, and the
// tooltip shows the reason — see src/devices/plug.js.
async function publishDeviceTransports() {
  const entries = buildTransportEntries(gladys, config);
  if (entries.length > 0) {
    await gladys.publishTransports(entries);
  }
}

function stopPushSubscriptions() {
  for (const cleanup of pushCleanups) {
    try {
      cleanup?.();
    } catch (err) {
      logger.error('Push subscription cleanup failed', err);
    }
  }
  pushCleanups = [];
}

// --- Graceful shutdown -------------------------------------------------------
// The SDK stops the push subscriptions, disconnects cleanly and exits with
// code 0 when the supervisor stops the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopPushSubscriptions();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the template integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
