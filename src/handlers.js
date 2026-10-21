// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the panel and the configured zones (the panel is not read again).
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceChanged(device));
  gladys.onDeviceUpdated((device) => app.deviceChanged(device));

  // The buttons (arm away, arm stay, disarm).
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.TEST_CONNECTION, () => app.testConnection());
  gladys.onAction(ACTIONS.ALLOW_CODE_RETRY, () => app.allowCodeRetry());

  // Scene actions. A missing mode is refused, never guessed: Gladys sends
  // the manifest default itself when the user left it.
  gladys.onSceneAction(SCENE_ACTIONS.ARM, async (fields) => {
    await app.arm(fields?.mode);
    return undefined;
  });
  gladys.onSceneAction(SCENE_ACTIONS.DISARM, async () => {
    await app.disarm();
    return undefined;
  });

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle: the first connection starts, a reconnection resends.
  gladys.on('connected', async () => {
    try {
      await app.connected(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
