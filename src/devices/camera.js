// -----------------------------------------------------------------------------
// Device type: CAMERA
// Illustrates the camera image channel of the SDK (v0.5.0+). A camera is a
// regular device carrying a `camera`/`image` feature; its images travel
// through a DEDICATED channel, never through publishState — out of the states
// history and of the 300 states/minute rate limit.
//
// Two complementary paths, both using the `image/jpg;base64,...` format
// (≤ 150 KB per image):
//   - PUSH: publish a periodic snapshot with `publishCameraImage`
//     (max 12 images/minute per device — the continuous video stream is out
//     of scope);
//   - PULL: answer `onGetImage` with a FRESH capture when Gladys asks for one
//     (live view of the dashboard widget, chat intent "show me the camera").
//     The ack is awaited under 15 s instead of the standard 5 s, so an
//     ffmpeg-style capture fits.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'camera';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here).
const PLATFORM_DEVICE_ID = 'cam-5fb214';

const FEATURE = { IMAGE: 'image' };

// How often the PUSH path publishes a snapshot. Stay well under the limit of
// 12 images/minute per device (i.e. at most one every 5 s).
const SNAPSHOT_INTERVAL_MS = 60_000;

// A tiny valid JPEG (1×1 pixel), used to simulate the camera sensor. In a real
// integration you would NOT embed an image in the code: captureSnapshot()
// below is where you talk to the actual camera.
const PLACEHOLDER_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
  'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
  'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCwooor8/P3E//Z';

/**
 * Capture one frame from the camera and return it in the SDK image format.
 * @returns {Promise<string>} `image/jpg;base64,...` string, ≤ 150 KB.
 */
async function captureSnapshot() {
  // ------------------------------------------------------------------ //
  // DO THE WORK: grab a real frame from your camera.
  // e.g. const jpeg = await fetch(`http://${cameraIp}/snapshot.jpg`)
  //        .then((r) => r.arrayBuffer());
  //      return `image/jpg;base64,${Buffer.from(jpeg).toString('base64')}`;
  // or spawn ffmpeg on an RTSP stream and collect one frame.
  // Keep the result under 150 KB (downscale/re-encode if needed).
  // ------------------------------------------------------------------ //
  return `image/jpg;base64,${PLACEHOLDER_JPEG_BASE64}`;
}

export const camera = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Entrance camera',
      external_id: ids.device,
      features: [
        {
          name: 'Image',
          external_id: ids.feature(FEATURE.IMAGE),
          category: DEVICE_FEATURE_CATEGORIES.CAMERA,
          type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
          read_only: true,
          has_feedback: false,
          // Images never go through the states history.
          keep_history: false,
        },
      ],
    };
  },

  // PULL path: Gladys needs a FRESH image right now (dashboard live view,
  // chat intent). Resolve the capture; the SDK acks it back as `data.image`.
  // Signature: (gladys, { device, config }) — this demo needs none of it.
  async onGetImage() {
    logger.info('onGetImage -> capturing a fresh frame');
    return captureSnapshot();
  },

  // PUSH path: publish a periodic snapshot so the dashboard widget stays
  // up to date even when nobody asked. Same startPush/cleanup contract as the
  // motion sensor.
  startPush(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    logger.info('Starting the periodic snapshot loop...');

    const interval = setInterval(async () => {
      try {
        const image = await captureSnapshot();
        await gladys.publishCameraImage(ids.device, image);
      } catch (e) {
        logger.error('publishCameraImage failed', e);
      }
    }, SNAPSHOT_INTERVAL_MS);

    // Return a cleanup function, called on disconnection.
    return () => clearInterval(interval);
  },
};
