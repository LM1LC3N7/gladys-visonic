// -----------------------------------------------------------------------------
// Entry point: SDK wiring only (src/handlers.js registers every handler BEFORE
// connect(), and delegates to the VisonicApp of src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { VisonicApp } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const app = new VisonicApp({ gladys });

registerHandlers(gladys, app, logger);
// Closing the connection frees the adapter (most take one client) for the next one.
// `final`: the container stops, the pending alarm event retries go with it.
gladys.handleShutdown(() => app.stop({ final: true }));

logger.info('Starting the Visonic integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
