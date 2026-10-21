// -----------------------------------------------------------------------------
// The integration: one TCP connection with the serial-to-network adapter of
// a Visonic PowerMax / PowerMaster panel (src/visonic/client.js), the panel
// model it reports, the Gladys devices and states (src/devices.js), the
// scene events, the commands. index.js only wires the SDK handlers to it.
//
// Safety:
// - arming is always allowed (it protects): never queued behind a disarm,
//   it withdraws the disarms still waiting; disarming is off unless the
//   configuration allows it, and that option is read again right before the
//   write;
// - a disarm decides on the state read from the panel right before it,
//   never on the state in memory, one at a time; an arm reads it too when
//   it can (already armed: nothing sent) but is not blocked by an unreadable
//   state;
// - a command is written within 3.5 s of the request or not at all (Gladys
//   waits 5 s); it counts as done only when the state read back shows it;
//   one that may have reached the panel is never reported "not sent", but
//   "sent, without confirmation", and the state is read again;
// - a user code refused by the panel ("access denied") is never sent again
//   by itself: the commands stop, across restarts, until the code changes or
//   "Allow a new try of the code" is clicked;
// - every command, sent or refused, is logged; the user code never is.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, sessionKey } from './config.js';
import { ARM_MODES, BUTTON_PUSH, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { buildDevices, buildStates, parseFeatureId } from './devices.js';
import { COMMAND_NAMES, MODE_NAMES, T, fill, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';
import { VisonicClient, VisonicError } from './visonic/client.js';
import { ZONE_EVENTS, eventMeaning } from './visonic/protocol.js';

/** A command refused before anything was sent to the panel. */
export class Refused extends Error {}

/** A motion zone shows "motion" this long after its event (the panel sends no end). */
const MOTION_HOLD = 30_000;
/** An alarm the panel never restores is cleared after this (pyvisonic bell time, 20 min). */
const BELL_TIME = 20 * 60_000;

const emptyAlarm = () => ({ intruder: false, kinds: new Set(), tamper: undefined, zone: null });

const emptyModel = () => ({ system: undefined, alarm: emptyAlarm(), zones: new Map() });

/** The scene event kind of an alarm (frozen: scenes compare it). */
export const ALARM_KINDS = ['intrusion', 'fire', 'panic', 'emergency', 'gas', 'flood'];

export class VisonicApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'visonic' }),
    client,
    connect,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = client ?? new VisonicClient({ connect, timers, now, logger });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.key = undefined;
    this.code = undefined;
    this.model = emptyModel();
    this.online = false;
    this.memory = undefined;
    this.savedAt = undefined;
    /** Incremented at every start: a late event of an older session is ignored. */
    this.session = 0;
    /** { mode, until }: what the last Gladys command asked. */
    this.commanded = undefined;
    /** The panel state at the last flush: the transitions start from it. */
    this.seen = undefined;
    this.readBacks = new Set();
    this.motionTimers = new Map();
    this.bellTimer = undefined;
    this.lastStatus = undefined;
    this.lastTransport = undefined;
    this.published = undefined;
    this.started = false;
    this.sweeper = undefined;
    this.flushTimer = undefined;
    this.downInfo = undefined;
    /** { code, at }: the last command frame written with a user code (memory only). */
    this.sentWithCode = undefined;
    /** Disarms asked and not finished (an arm withdraws them). */
    this.disarms = new Set();
    this.commands = Promise.resolve();
    this.starting = Promise.resolve();
    // Every model change is applied when the client emits it, in the order of
    // emission; guard() only queues what talks to Gladys, and drops it when
    // a new session started meanwhile.
    this.client.on('attempt', ({ at }) => this.noteAttempt(at));
    this.client.on('up', ({ status }) => {
      this.applySystem(status);
      this.online = true;
      this.downInfo = undefined;
      this.guard(() => this.onUp());
    });
    this.client.on('down', (info) => {
      const wasOnline = this.online;
      this.online = false;
      this.downInfo = { ...info, at: this.now() };
      this.noteFailures(info.failures);
      this.guard(() => this.onDown(info, wasOnline));
    });
    this.client.on('status', (status) => {
      if (status.system) this.applySystem(status.system, status.zoneEvent);
      if (status.masks) this.applyMasks(status.masks);
      this.noteChange();
    });
    this.client.on('events', (events) => {
      for (const event of events) this.applyEvent(event);
      this.noteChange();
    });
    // A denial that answers no command in flight (late, after its command timed out).
    this.client.on('denied', () => this.lateDenied());
  }

  /** Client events run one after the other, in order; those of an older session are dropped. */
  guard(fn) {
    const session = this.session;
    this.chain = (this.chain ?? Promise.resolve())
      .then(() => (session === this.session ? fn() : undefined))
      .catch((err) => this.logger.error(`Visonic event failed: ${err.message}`));
    return this.chain;
  }

  get language() {
    return this.config.language;
  }

  error(entry, cause) {
    return new Error(word(entry, this.language), cause ? { cause } : undefined);
  }

  refused(entry) {
    return new Refused(word(entry, this.language));
  }

  // --- Memory (/data) ----------------------------------------------------------

  async loadMemory() {
    if (this.memory) return this.memory;
    const raw = await Promise.resolve()
      .then(() => this.store.load())
      .catch(() => null);
    this.memory = normalizeMemory(raw, this.now());
    return this.memory;
  }

  async saveMemory() {
    if (!this.memory) return;
    this.savedAt = this.now();
    try {
      await this.store.save(this.memory);
    } catch (err) {
      this.logger.warn(`Saving the state to /data failed: ${err.message}`);
    }
  }

  /** The instant of a connection attempt: kept, written at most once a minute. */
  noteAttempt(at) {
    if (!this.memory) this.memory = normalizeMemory(null, this.now());
    this.memory.lastAttemptAt = at;
    this.memory.failures = this.client.failures;
    if (this.savedAt === undefined || this.now() - this.savedAt >= TIMINGS.attemptSave) {
      this.saveMemory();
    }
  }

  noteFailures(failures) {
    if (!this.memory || this.memory.failures === failures) return;
    this.memory.failures = failures;
    if (this.savedAt === undefined || this.now() - this.savedAt >= TIMINGS.attemptSave) {
      this.saveMemory();
    }
  }

  /** The first connection after a (re)start: never sooner than the last attempt allows. */
  notBefore() {
    const { lastAttemptAt, failures } = this.memory;
    if (!lastAttemptAt) return 0;
    const wait =
      failures > 0
        ? TIMINGS.backoff[Math.min(failures - 1, TIMINGS.backoff.length - 1)]
        : TIMINGS.sessionGap;
    return lastAttemptAt + wait;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Starts (or restarts); two starts never overlap (no leaked timer). */
  start(raw = {}) {
    const run = this.starting.then(() => this.startNow(raw));
    this.starting = run.catch(() => undefined);
    return run;
  }

  async startNow(raw = {}) {
    this.stop();
    this.session += 1;
    const next = normalizeConfig(raw);
    if (sessionKey(next) !== this.key) {
      // Another panel, maybe: what we knew no longer holds.
      this.model = emptyModel();
      this.seen = undefined;
    }
    this.config = next;
    this.key = sessionKey(next);
    this.code = next.code;
    this.online = false;
    this.downInfo = undefined;
    if (next.zoneErrors.length > 0) {
      this.logger.warn(`Zones not understood: ${next.zoneErrors.join(', ')}`);
    }
    if (next.codeInvalid) this.logger.warn('The user code is not 4 digits: ignored');
    await this.loadMemory();
    await this.publishDevices();
    await this.publishStates();
    const problem = this.configProblem();
    if (problem) {
      await this.setStatus(false, problem);
      return;
    }
    this.client.configure({ host: next.host, port: next.port });
    const notBefore = this.notBefore();
    this.client.start({ notBefore, failures: this.memory.failures });
    const wait = notBefore - this.now();
    await this.setStatus(
      false,
      wait > 0 && !this.client.busy ? fill(T.waiting, wait) : T.connecting,
    );
    this.startSweeper();
  }

  startSweeper() {
    if (this.sweeper) this.timers.clearInterval(this.sweeper);
    this.sweeper = this.timers.setInterval(() => this.guard(() => this.sweep()), TIMINGS.sweep);
  }

  /**
   * Stops the connection. `final` only when the container stops: a restart
   * (new address) keeps the alarm_triggered retries running.
   */
  stop({ final = false } = {}) {
    this.client.stop();
    this.online = false;
    this.publisher.stop({ final });
    if (this.sweeper) this.timers.clearInterval(this.sweeper);
    this.sweeper = undefined;
    if (this.flushTimer) this.timers.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.bellTimer) this.timers.clearTimeout(this.bellTimer);
    this.bellTimer = undefined;
    for (const timer of this.readBacks) this.timers.clearTimeout(timer);
    this.readBacks.clear();
    for (const timer of this.motionTimers.values()) this.timers.clearTimeout(timer);
    this.motionTimers.clear();
  }

  configProblem() {
    if (!this.config.host) return T.noHost;
    if (!this.config.port) return T.noPort;
    return undefined;
  }

  /** First connection to Gladys: start; a reconnection (Gladys restarted): resend everything. */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    // Gladys keeps the connection status and the discovered devices in memory.
    this.published = undefined;
    this.lastTransport = undefined;
    const status = this.lastStatus;
    this.lastStatus = undefined;
    await this.configUpdated(raw);
    if (status && this.lastStatus === undefined) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    this.publisher.forget();
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports(
      this.online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
    );
  }

  /**
   * A new address or port reconnects; a new user code lifts its stop; the
   * rest (zones, option, language) applies at once, without reading the
   * panel again.
   */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    // First of all: an option switched off applies to the commands at once.
    this.config = next;
    if (next.code !== this.code) {
      this.code = next.code;
      await this.liftCodeStop();
    }
    if (sessionKey(next) !== this.key) return this.start(raw);
    await this.publishDevices();
    await this.publishStates();
    if (this.online) await this.setStatus(true, this.connectedMessage());
    return undefined;
  }

  async liftCodeStop() {
    const memory = await this.loadMemory();
    if (!memory.codeStop) return;
    memory.codeStop = null;
    await this.saveMemory();
    this.logger.info('Visonic: the stop on the refused user code is lifted');
  }

  codeStopped() {
    return Boolean(this.memory?.codeStop);
  }

  /**
   * The panel refused the user code: no command until the code changes or
   * "Allow a new try of the code" is clicked. Persisted at once (before any
   * other command can see the memory), told without waiting for Gladys.
   */
  stopOnCode(why) {
    if (!this.memory) this.memory = normalizeMemory(null, this.now());
    const already = Boolean(this.memory.codeStop);
    this.memory.codeStop = { at: this.now() };
    if (!already) {
      this.logger.error(`Visonic: the panel refused the user code (${why}): commands stopped`);
    }
    const saved = this.saveMemory();
    if (this.online) this.setStatus(true, this.connectedMessage());
    return saved;
  }

  /** A late denial: it counts if a command with the current code just left. */
  lateDenied() {
    const sent = this.sentWithCode;
    const recent =
      sent &&
      sent.code === this.config.code &&
      this.now() - sent.at <= TIMINGS.answerBy + TIMINGS.uncertain;
    if (!recent) {
      this.logger.debug('Visonic: "access denied" that answers no command of ours');
      return;
    }
    this.stopOnCode('late answer');
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  connectedMessage() {
    const mode = this.model.system?.mode ?? 'unknown';
    const message = {
      en: T.connected.en(word(MODE_NAMES[mode], 'en').toLowerCase(), this.config.zones.size),
      fr: T.connected.fr(word(MODE_NAMES[mode], 'fr').toLowerCase(), this.config.zones.size),
    };
    if (!this.codeStopped()) return message;
    return { en: message.en + T.codeStopped.en, fr: message.fr + T.codeStopped.fr };
  }

  // --- Model -------------------------------------------------------------------

  alarmOn() {
    return this.model.alarm.intruder || this.model.alarm.kinds.size > 0;
  }

  /** An alarm the panel never restores is cleared after the bell time. */
  armBellTimer() {
    if (this.bellTimer) this.timers.clearTimeout(this.bellTimer);
    this.bellTimer = this.timers.setTimeout(() => {
      this.bellTimer = undefined;
      this.model.alarm.intruder = false;
      this.model.alarm.kinds.clear();
      this.noteChange();
    }, BELL_TIME);
  }

  /**
   * A system status (A5 04). In Standard mode the panel says nothing more
   * of an intrusion than its alarm flag while armed, out of the entry delay
   * (pyvisonic's rule); a disarm ends the intrusion.
   */
  applySystem(system, zoneEvent) {
    const alarm = this.model.alarm;
    this.model.system = system;
    if (system.entry) alarm.delaySeen = true;
    if (system.armed && !system.entry && system.alarmEvent && !alarm.intruder) {
      alarm.intruder = true;
      this.armBellTimer();
    }
    if (system.mode === 'disarmed') {
      alarm.intruder = false;
      alarm.delaySeen = false;
      alarm.zone = null;
    }
    if (zoneEvent) this.applyZoneEvent(zoneEvent);
  }

  zone(n) {
    if (!this.model.zones.has(n)) this.model.zones.set(n, {});
    return this.model.zones.get(n);
  }

  /** The masks of A5 01, 02, 03, 06 (zones 1 to 32). */
  applyMasks(masks) {
    const names = { trip: 'trip', open: 'open', battery: 'battery', tamper: 'tamper' };
    for (const n of this.config.zones.keys()) {
      const zone = this.zone(n);
      for (const [mask, set] of Object.entries(masks)) {
        if (names[mask]) zone[names[mask]] = set.has(n);
        if (mask === 'bypass') zone.bypass = set.has(n);
      }
    }
  }

  /** A zone event of A5 04 (pyvisonic pmZoneEventAction). */
  applyZoneEvent({ zone: n, event }) {
    const change = ZONE_EVENTS[event];
    if (!change || !this.config.zones.has(n)) return;
    const zone = this.zone(n);
    for (const [key, value] of Object.entries(change)) {
      if (key !== 'motion') zone[key] = value;
    }
    if (change.motion) {
      // The panel sends a motion, never its end: shown for MOTION_HOLD.
      zone.motion = true;
      if (this.motionTimers.has(n)) this.timers.clearTimeout(this.motionTimers.get(n));
      this.motionTimers.set(
        n,
        this.timers.setTimeout(() => {
          this.motionTimers.delete(n);
          zone.motion = false;
          this.noteChange();
        }, MOTION_HOLD),
      );
    }
  }

  /** An event of A7 (pyvisonic `update_panel_state`). */
  applyEvent({ zone, type }) {
    const meaning = eventMeaning(type);
    const alarm = this.model.alarm;
    const system = this.model.system;
    if (meaning.intruder && system?.armed && !system.entry) {
      // ALARM_DELAY alone also comes when the exit delay ends: only after an entry delay.
      if (!meaning.delay || alarm.delaySeen) {
        if (!alarm.intruder) alarm.zone = zone >= 1 && zone <= 64 ? zone : null;
        alarm.intruder = true;
        this.armBellTimer();
      }
    }
    if (meaning.intruderRestore) alarm.intruder = false;
    if (meaning.alarm) {
      alarm.kinds.add(meaning.alarm);
      if (alarm.zone === null && zone >= 1 && zone <= 64) alarm.zone = zone;
      this.armBellTimer();
    }
    if (meaning.alarmRestore) alarm.kinds.clear();
    if (meaning.tamper !== undefined) alarm.tamper = meaning.tamper;
  }

  /** States and transitions go to Gladys at once, in order, through the guard. */
  noteChange() {
    if (this.flushTimer) return;
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = undefined;
      this.guard(() => this.flushChanges());
    }, 0);
  }

  snapshot() {
    const system = this.model.system;
    if (!system) return undefined;
    const alarm = this.model.alarm;
    return {
      mode: system.mode,
      alarm: alarm.intruder || alarm.kinds.size > 0,
      kinds: new Set([...(alarm.intruder ? ['intrusion'] : []), ...alarm.kinds]),
    };
  }

  async flushChanges() {
    const session = this.session;
    const now = this.snapshot();
    const events = now ? this.transitions(this.seen, now) : [];
    if (now) this.seen = now;
    await this.publishStates();
    for (const event of events) {
      // A new configuration meanwhile: what the old session saw is not news.
      if (session !== this.session) return;
      await this.effect(event);
    }
    if (this.online && session === this.session) {
      await this.setStatus(true, this.connectedMessage());
    }
  }

  /** Nothing for the first status seen after a start. */
  transitions(before, after) {
    if (!before) return [];
    const events = [];
    const armed = (mode) => mode === 'armed_away' || mode === 'armed_stay';
    if (before.mode !== after.mode) {
      if (armed(after.mode)) {
        events.push({ type: 'armed', mode: after.mode });
      } else if (
        after.mode === 'disarmed' &&
        before.mode !== 'arming' &&
        before.mode !== 'unknown'
      ) {
        events.push({ type: 'disarmed' });
      }
    }
    for (const kind of after.kinds) {
      if (!before.kinds.has(kind)) events.push({ type: 'alarm', kind });
    }
    return events;
  }

  /** Whether a transition answers a Gladys command; the entry is used once. */
  byGladys(mode) {
    const asked = this.commanded;
    const match = Boolean(asked && asked.mode === mode && this.now() < asked.until);
    if (match) this.commanded = undefined;
    return match;
  }

  async effect(event) {
    if (event.type === 'armed') {
      const byGladys = this.byGladys(event.mode);
      this.logger.info(
        `Panel: ARMED ${event.mode} (${byGladys ? 'Gladys command' : 'keypad or other'})`,
      );
      await this.publisher.sceneEvent(SCENE_TRIGGERS.ARMED, {
        mode: event.mode,
        by_gladys: byGladys,
      });
    } else if (event.type === 'disarmed') {
      const byGladys = this.byGladys('disarmed');
      this.logger.info(`Panel: DISARMED (${byGladys ? 'Gladys command' : 'keypad or other'})`);
      await this.publisher.sceneEvent(SCENE_TRIGGERS.DISARMED, { by_gladys: byGladys });
    } else if (event.type === 'alarm') {
      const zone = this.model.alarm.zone;
      this.logger.warn(`Panel: ALARM ${event.kind}${zone ? ` zone ${zone}` : ''}`);
      await this.publisher.sceneEvent(SCENE_TRIGGERS.ALARM_TRIGGERED, {
        kind: event.kind,
        zone,
        fire: event.kind === 'fire',
      });
    }
  }

  // --- Client events (Gladys side) ------------------------------------------------

  async onUp() {
    await this.publishDevices();
    await this.flushChanges();
    await this.setStatus(true, this.connectedMessage());
    await this.publishTransports(DEVICE_TRANSPORTS.LOCAL);
  }

  async onDown({ reason, retryIn, silent }, wasOnline) {
    if (silent) {
      this.logger.warn(`Visonic: no status from the panel; next try in ${retryIn / 1000} s`);
      await this.setStatus(false, fill(T.silent, retryIn));
    } else {
      this.logger.warn(`Visonic: ${reason}; next try in ${retryIn / 1000} s`);
      await this.setStatus(false, fill(T.unreachable, reason, retryIn));
    }
    if (wasOnline || this.lastTransport !== undefined) {
      await this.publishStates();
      await this.publishTransports(DEVICE_TRANSPORTS.UNREACHABLE);
    }
  }

  /** Heartbeats of the unchanged states; an expired command memory goes. */
  async sweep() {
    if (this.commanded && this.now() >= this.commanded.until) this.commanded = undefined;
    await this.publishStates();
  }

  // --- Gladys ----------------------------------------------------------------

  devices() {
    return buildDevices(this.gladys, this.config);
  }

  async publishDevices({ force = false } = {}) {
    const devices = this.devices();
    const json = JSON.stringify(devices);
    if (json === this.published && !force) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the devices failed: ${err.message}`);
    }
  }

  publishStates() {
    return this.publisher.publish(
      buildStates(this.gladys, this.config, this.model, { online: this.online }),
    );
  }

  async publishTransports(transport) {
    if (transport === this.lastTransport) return;
    const entries = this.devices().map((device) => ({
      external_id: device.external_id,
      transport,
    }));
    try {
      for (let i = 0; i < entries.length; i += 100) {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      }
      this.lastTransport = transport;
    } catch (err) {
      this.logger.warn(`Publishing the transports failed: ${err.message}`);
    }
  }

  /** Discovery: the devices again, from the configuration; the panel is not read. */
  async scan() {
    await this.publishDevices({ force: true });
  }

  /** The user created or updated a device: Gladys has none of its states yet, send them again. */
  async deviceChanged(device) {
    this.publisher.forget(device?.external_id);
    await this.publishStates();
  }

  // --- Commands --------------------------------------------------------------

  /** A button pressed in Gladys. Only a push (1) of a panel button acts. */
  async setValue(_device, feature, value) {
    const target = parseFeatureId(feature?.external_id);
    const asked = this.now();
    const pressed = value === BUTTON_PUSH.PRESSED || value === String(BUTTON_PUSH.PRESSED);
    const action = target && `${target.kind}:${target.key}`;
    const handlers = {
      'panel:arm-away': () => this.arm('armed_away', asked),
      'panel:arm-stay': () => this.arm('armed_stay', asked),
      'panel:disarm': () => this.disarm(asked),
    };
    if (!handlers[action]) throw new Error(`${feature?.external_id} is read-only`);
    if (!pressed) throw new Error(`Unexpected value ${JSON.stringify(value)} for a button`);
    await handlers[action]();
  }

  /** Disarming needs its option, read now (and again before the write). */
  checkDisarmAllowed() {
    if (this.config.allowDisarm) return;
    this.logger.warn('Disarm REFUSED: disabled in the configuration');
    throw this.refused(T.disarmRefused);
  }

  /** Every command needs the user code; a refused one is never sent again by itself. */
  checkCode(mode) {
    if (this.config.codeInvalid) throw this.refused(T.badCode);
    if (!this.config.code) throw this.refused(T.noCode);
    if (this.codeStopped()) {
      this.logger.warn(
        `Command REFUSED (${COMMAND_NAMES[mode].en}): the user code was refused before`,
      );
      throw this.refused(T.codeRefusedBefore);
    }
  }

  check(mode) {
    if (mode === 'disarmed') this.checkDisarmAllowed();
    this.checkCode(mode);
  }

  /** The state the panel shows now matches the command. */
  static shows(mode, system) {
    if (!system) return false;
    if (mode === 'disarmed') return system.mode === 'disarmed';
    return system.mode === mode || system.arming === mode;
  }

  /**
   * How much a state protects: 0 disarmed (or unknown), 1 armed stay (or
   * arming it), 2 armed away (or arming it, or the entry delay of an armed
   * panel).
   */
  static protection(system) {
    const mode = system.arming ?? system.mode;
    if (mode === 'armed_away' || mode === 'entry_delay') return 2;
    if (mode === 'armed_stay') return 1;
    return 0;
  }

  /** The system status read now; refused (nothing sent) when it cannot be read by readBy. */
  async freshStatus(asked, { first = false, kind } = {}) {
    if (!this.client.connected) throw this.refused(T.offline);
    const readBy = asked + TIMINGS.readBy;
    if (readBy - this.now() < 100) throw this.refused(T.tooLate);
    try {
      return await this.client.readStatus({ sendBy: readBy, answerBy: readBy, first, kind });
    } catch (err) {
      if (err instanceof VisonicError && err.kind === 'late') throw this.refused(T.tooLate);
      if (err instanceof VisonicError && err.kind === 'offline') throw this.refused(T.offline);
      if (err instanceof VisonicError && err.kind === 'withdrawn') {
        throw this.refused(T.disarmWithdrawn);
      }
      throw this.refused(T.stateUnknown);
    }
  }

  /**
   * Arm away or stay. Protective: never behind a disarm (it withdraws those
   * still waiting), never blocked by an unreadable state; the user code is
   * still needed, and a refused one still stops it.
   */
  async arm(mode, asked = this.now()) {
    if (!ARM_MODES.includes(mode)) throw new Error(`Unknown arming mode ${mode}`);
    const label = COMMAND_NAMES[mode].en;
    this.checkCode(mode);
    this.withdrawDisarms();
    const session = this.session;
    let status;
    if (!this.client.connected) {
      // Waiting between two attempts (a cut, a restart): an arm is never
      // blocked by those waits, it gets one attempt now.
      status = await this.wakeForArm(asked);
    }
    try {
      status ??= await this.freshStatus(asked, { first: true });
    } catch (err) {
      if (!(err instanceof Refused) || !this.client.connected) throw err;
      // Unreadable: an arm protects, it is sent anyway.
      this.logger.warn(`Arm: the state could not be read (${err.message}); sent anyway`);
    }
    if (session !== this.session) throw this.refused(T.restarted);
    if (status && VisonicApp.protection(status) >= VisonicApp.protection({ mode })) {
      // Never "arm stay" over "armed away": that would lower the protection.
      this.logger.info(`Panel already ${status.mode} (${label}): nothing sent`);
      return;
    }
    if (status?.mode === 'programming') {
      this.logger.warn(`Arm REFUSED (${label}): the panel is in programming`);
      throw this.refused(T.programming);
    }
    this.checkCode(mode);
    this.logger.info(`ARMING from Gladys: ${label}`);
    await this.send(mode, asked, { first: true });
  }

  /**
   * One connection attempt now for an arm, outside the waits between
   * attempts; resolves with the status that opened the session, or refuses
   * (nothing sent) when it is not up by readBy.
   */
  async wakeForArm(asked) {
    if (!this.client.busy) {
      if (!this.client.wake()) throw this.refused(T.offline);
      this.logger.info('Arm asked while disconnected: one connection attempt now');
    }
    const left = asked + TIMINGS.readBy - this.now();
    const result = await new Promise((resolve) => {
      const done = (value) => {
        this.client.off('up', onUp);
        this.client.off('down', onDown);
        this.timers.clearTimeout(timer);
        resolve(value);
      };
      const onUp = ({ status }) => done(status);
      const onDown = () => done(undefined);
      const timer = this.timers.setTimeout(() => done(undefined), Math.max(0, left));
      this.client.on('up', onUp);
      this.client.on('down', onDown);
    });
    if (!result) throw this.refused(T.offline);
    return result;
  }

  /** An arm withdraws every disarm still waiting (queued in the app or in the client). */
  withdrawDisarms() {
    let count = 0;
    for (const ticket of this.disarms) {
      if (!ticket.withdrawn && !ticket.sending) {
        ticket.withdrawn = true;
        count += 1;
      }
    }
    count += this.client.withdraw('disarm');
    if (count > 0) this.logger.warn('Disarm WITHDRAWN: an arm was asked meanwhile');
  }

  /**
   * Disarm: off unless allowed; one at a time, in the order asked; decided
   * on the state read now. A disarm whose own time ran out while it waited
   * its turn is refused, nothing sent.
   */
  async disarm(asked = this.now()) {
    const label = COMMAND_NAMES.disarmed.en;
    this.check('disarmed');
    const ticket = { withdrawn: false, sending: false };
    this.disarms.add(ticket);
    const start = async () => {
      if (ticket.withdrawn) throw this.refused(T.disarmWithdrawn);
      if (this.now() >= asked + TIMINGS.readBy) {
        this.logger.warn('Disarm REFUSED: its time ran out behind other commands');
        throw this.refused(T.commandBusy);
      }
      this.check('disarmed');
      const session = this.session;
      const status = await this.freshStatus(asked, { kind: 'disarm' });
      if (ticket.withdrawn) throw this.refused(T.disarmWithdrawn);
      if (session !== this.session) throw this.refused(T.restarted);
      if (status.mode === 'disarmed' && !this.alarmOn()) {
        this.logger.info('Panel already disarmed: nothing sent');
        return;
      }
      if (status.mode === 'programming') {
        this.logger.warn(`Disarm REFUSED (${label}): the panel is in programming`);
        throw this.refused(T.programming);
      }
      this.check('disarmed');
      this.logger.info(`DISARMING from Gladys (state read: ${status.mode})`);
      await this.send('disarmed', asked, { kind: 'disarm', ticket });
    };
    const run = this.commands.then(start, start).finally(() => this.disarms.delete(ticket));
    this.commands = run.catch(() => undefined);
    return run;
  }

  /**
   * Writes a command decided on a fresh state, then reads the state back
   * until it shows it (or answerBy). Resolves when it does; throws Refused
   * when nothing was sent, an Error otherwise ("sent, without confirmation").
   */
  async send(mode, asked, { first = false, kind, ticket } = {}) {
    const label = COMMAND_NAMES[mode].en;
    const name = word(COMMAND_NAMES[mode], this.language);
    if (this.now() > asked + TIMINGS.sendBy) {
      this.logger.warn(`Command NOT sent (${label}): too late`);
      throw this.refused(T.tooLate);
    }
    this.check(mode);
    const code = this.config.code;
    const session = this.session;
    const onSent = () => {
      this.commanded = { mode, until: this.now() + TIMINGS.commandMemory };
    };
    try {
      await this.client.command(mode, code, {
        sendBy: asked + TIMINGS.sendBy,
        // Absolute: the client waits from the write up to it, whatever was ahead.
        answerBy: asked + TIMINGS.answerBy,
        first,
        kind,
        // The code of this frame, kept in memory: a late refusal of it stops the commands.
        onWrite: () => {
          if (ticket) ticket.sending = true;
          this.sentWithCode = { code, at: this.now() };
        },
        // …and run once more by the client, right before the socket write.
        check: () => {
          if (ticket?.withdrawn || session !== this.session) return false;
          if (this.now() > asked + TIMINGS.sendBy) return false;
          try {
            this.check(mode);
            return this.config.code === code;
          } catch {
            return false;
          }
        },
      });
    } catch (err) {
      if (err instanceof VisonicError && !err.sent) {
        this.logger.warn(`Command NOT sent (${label}): ${err.message}`);
        if (err.kind === 'withdrawn') {
          if (ticket?.withdrawn) throw this.refused(T.disarmWithdrawn);
          if (session !== this.session) throw this.refused(T.restarted);
          // The precise reason (option switched off, code changed or stopped).
          this.check(mode);
        }
        throw this.refused(err.kind === 'offline' ? T.offline : T.tooLate);
      }
      if (err instanceof VisonicError && err.kind === 'denied') {
        this.logger.error(`Command REFUSED by the panel (${label}): access denied (user code)`);
        await this.stopOnCode('access denied');
        this.scheduleReadBack();
        throw this.error(fill(T.codeRefused, name));
      }
      if (err instanceof VisonicError && err.kind === 'ambiguous' && err.denied) {
        // This frame or the one before (with this code) was refused.
        await this.stopOnCode('ambiguous answer');
      }
      this.logger.warn(`Command sent, NOT confirmed (${label}): ${err.message}`);
      onSent();
      this.scheduleReadBack();
      throw this.error(fill(T.unconfirmed, name), err);
    }
    onSent();
    // Acknowledged: done only when the state read back shows it.
    const confirmed = await this.confirm(mode, asked);
    this.scheduleReadBack();
    if (!confirmed) {
      this.logger.warn(`Command acknowledged, state NOT confirmed yet (${label})`);
      throw this.error(fill(T.notApplied, name));
    }
    this.logger.info(`Command confirmed by the state read back (${label})`);
  }

  /** Reads the state again until it shows the command, at most until answerBy. */
  async confirm(mode, asked) {
    const answerBy = asked + TIMINGS.answerBy;
    while (answerBy - this.now() > 250) {
      try {
        const status = await this.client.readStatus({
          sendBy: answerBy - 200,
          answerBy,
          first: true,
        });
        if (VisonicApp.shows(mode, status)) return true;
      } catch {
        return false;
      }
      await new Promise((resolve) => this.timers.setTimeout(resolve, 150));
    }
    return false;
  }

  scheduleReadBack() {
    const timer = this.timers.setTimeout(() => {
      this.readBacks.delete(timer);
      if (!this.client.connected) return;
      this.client
        .readStatus()
        .catch((err) => this.logger.debug(`Read back failed: ${err.message}`));
    }, TIMINGS.readBack);
    this.readBacks.add(timer);
  }

  // --- Configuration buttons -----------------------------------------------------

  /**
   * "Test the connection": tells what the session knows. It never opens a
   * connection sooner than the waits allow, and sends nothing to the panel
   * (the status is read every 25 s anyway); the user code is not used.
   */
  async testConnection() {
    const problem = this.configProblem();
    if (problem) throw this.error(problem);
    await this.chain;
    if (this.client.connected) {
      await this.setStatus(true, this.connectedMessage());
      return this.connectedMessage();
    }
    const next = this.client.nextAttemptAt;
    if (this.downInfo) {
      const wait = Math.max(0, (next ?? this.now()) - this.now());
      throw this.error(
        this.downInfo.silent
          ? fill(T.silent, wait)
          : fill(T.unreachable, this.downInfo.reason, wait),
      );
    }
    if (next !== undefined && next > this.now())
      throw this.error(fill(T.waiting, next - this.now()));
    throw this.error(T.connecting);
  }

  /**
   * "Allow a new try of the code": the user's explicit go for the next
   * command to send the code again (nothing is sent now).
   */
  async allowCodeRetry() {
    if (!this.codeStopped()) return T.codeNotStopped;
    await this.liftCodeStop();
    if (this.online) await this.setStatus(true, this.connectedMessage());
    return T.codeRetryAllowed;
  }
}
