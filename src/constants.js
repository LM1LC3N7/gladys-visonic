// -----------------------------------------------------------------------------
// Fixed values: manifest keys, Gladys value enums, protocol limits and timings.
// The SDK exports the Gladys categories and types, not the state values: the
// ones used here mirror server/utils/constants.js of the core.
// -----------------------------------------------------------------------------

/** Manifest keys: frozen, users store them in scenes and dashboards. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  ALLOW_CODE_RETRY: 'allow_code_retry',
};

export const SCENE_ACTIONS = {
  ARM: 'arm',
  DISARM: 'disarm',
};

export const SCENE_TRIGGERS = {
  ALARM_TRIGGERED: 'alarm_triggered',
  ARMED: 'armed',
  DISARMED: 'disarmed',
};

/** Arming modes of a scene action or of an `armed` event (frozen: scenes compare them). */
export const ARM_MODES = ['armed_away', 'armed_stay'];

/**
 * Every mode the panel can show: `arming` (exit delay), `entry_delay`,
 * `programming` (installer menu or download in progress, no command then).
 */
export const MODES = [
  'disarmed',
  'arming',
  'entry_delay',
  'armed_away',
  'armed_stay',
  'programming',
  'unknown',
];

/** How a zone shows in Gladys (frozen: stored in the configuration). */
export const ZONE_KINDS = ['opening', 'motion', 'smoke', 'leak'];

/** Gladys core values (server/utils/constants.js). */
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const BUTTON_PUSH = { PRESSED: 1 };

export const LIMITS = {
  /** The status messages (A5) of Standard mode cover zones 1 to 32. */
  maxZones: 32,
  /** Requests in a row without an answer before the link counts as dead. */
  maxTimeouts: 3,
  /** States per minute sent to Gladys (the core admits 300), shared by every publication. */
  statesPerMinute: 240,
  /** Part of it only the panel may use. */
  priorityStates: 60,
  /** Scene events per minute (the core admits 300); alarm_triggered is never dropped. */
  eventsPerMinute: 120,
  /** Tries of an alarm_triggered event refused by Gladys or the network. */
  alarmEventTries: 3,
  /** Bytes waiting in the socket write buffer before the session is cut (a flood). */
  maxPendingWrite: 64 * 1024,
  /** Malformed frames in a row, without a good frame between, before the link is cut. */
  maxRejects: 50,
  /** Frames received per second before the link is cut (a flood, a loop). */
  maxFramesPerSecond: 200,
};

export const TIMINGS = {
  /** TCP connection to the adapter. */
  connectTimeout: 10_000,
  /** One request (pyvisonic waits for the reply of a status request). */
  requestTimeout: 5_000,
  /** The first status after connecting: the panel may be slow to answer. */
  firstStatusTimeout: 10_000,
  /** A status request when the line is idle this long (pyvisonic KEEP_ALIVE_PERIOD, 25 s). */
  keepAlive: 25_000,
  /** Nothing received for this long while connected: the link is dead (pyvisonic, 120 s). */
  watchdog: 120_000,
  /** Waits before reconnecting, in a row (the last one repeats). */
  backoff: [10_000, 30_000, 60_000, 120_000, 300_000],
  /** Never a new connection sooner than this after the last one closed. */
  sessionGap: 5_000,
  /** A partial frame older than this is dropped (pyvisonic: 2 s between chunks). */
  frameGap: 2_000,
  /** A late answer may still come this long after a command timed out. */
  uncertain: 10_000,
  /** At most one summary line of the rejected frames per this period. */
  rejectLog: 60_000,
  /** The instant of the last connection attempt is written to /data at most this often. */
  attemptSave: 60_000,
  /**
   * Gladys waits 5 s for a set_value ack. A command's fresh state must be
   * read by readBy, the command written by sendBy after it was asked (else
   * refused, nothing sent), and its answer and confirmation awaited until
   * answerBy (then "sent, not confirmed").
   */
  readBy: 2_500,
  sendBy: 3_500,
  answerBy: 4_500,
  /** The state is read again this long after a command. */
  readBack: 2_000,
  /** A transition seen this long after a Gladys command is credited to it. */
  commandMemory: 5 * 60_000,
  /** How often the unchanged states get their heartbeat checked. */
  sweep: 60_000,
  /** An unchanged state is sent again this often… */
  stateHeartbeat: 30 * 60_000,
  /** …plus a per-feature offset within this spread. */
  heartbeatSpread: 5 * 60_000,
  /** Waits between two tries of an alarm_triggered event. */
  alarmEventRetry: [5_000, 20_000],
};
