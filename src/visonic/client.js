// -----------------------------------------------------------------------------
// One TCP connection with the serial-to-network adapter (RS-232 to Ethernet
// or Wi-Fi) wired to the serial port of a Visonic PowerMax or PowerMaster
// panel, in Standard mode, ported from pyvisonic 4.0.8 (MIT, see
// THIRD_PARTY_NOTICES.md): the acknowledge of every panel message that wants
// one (`py_visonic_protocol_base.py`), the status request that proves the
// link (its connection test: a checksum-checked status reply, an
// acknowledge alone is not enough), the status request when the line is
// idle for 25 s and the 120 s watchdog (`py_visonic_sequencer.py`), the
// arming and disarming command and its acknowledge or "access denied"
// (`py_visonic.py`).
//
// Not ported, on purpose: the download of the panel memory (it needs the
// download code and puts the panel in a programming state), the Powerlink
// enrolment (the integration would register itself in the panel as a
// Powerlink accessory), the B0 requests of PowerMaster panels, the camera
// images, the bypass, the event log, the serial and USB links.
//
// Changed from pyvisonic: one request at a time with the answer it expects
// (a status reply after the write, or the acknowledge / denial of a
// command); a command is never written after its deadline and its own check
// is run right before the write; after a command timed out, an acknowledge
// is ambiguous for 10 s; a command is never written while the acknowledge
// of a status request may still come (it would pass for the command's);
// reconnection with growing waits (10 s to 5 min); a flood or too many
// malformed frames cut the link; the user code is never logged (requests are
// logged by a label).
//
// Events: 'up' { status }, 'down' { reason, retryIn, wasUp, silent },
// 'status' (an A5 message, decoded), 'events' ([{ zone, type }] of an A7),
// 'denied' (an "access denied" that answers no command in flight),
// 'attempt' (the instant of a connection attempt).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import { LIMITS, TIMINGS } from '../constants.js';
import { FrameReader, encodeFrame, needsAck } from './frame.js';
import {
  ACK,
  STATUS_ALL,
  STATUS_SYSTEM,
  TYPE,
  armFrame,
  decodeEvents,
  decodeStatus,
} from './protocol.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Every 12th keep-alive asks for every status message (zones too): about every 5 min. */
const FULL_STATUS_EVERY = 12;

/** After a status reply, its acknowledge may still come this long. */
const ACK_OWED = 500;

/**
 * kind: `offline` (nothing sent), `late` (not written in time, nothing sent),
 * `withdrawn` (its check failed right before the write, or it was withdrawn
 * from the queue, nothing sent), `timeout` (sent, no answer), `lost` (the
 * connection ended while it waited), `denied` (the panel answered "access
 * denied"), `ambiguous` (an answer that may belong to an earlier command).
 * `sent` tells whether the request may have reached the panel.
 */
export class VisonicError extends Error {
  constructor(message, kind, { sent = false } = {}) {
    super(message);
    this.kind = kind;
    this.sent = sent;
  }
}

const hex = (type) => `0x${type.toString(16).padStart(2, '0').toUpperCase()}`;

export class VisonicClient extends EventEmitter {
  constructor({
    connect = (options) => createConnection(options),
    timers = globalThis,
    now = Date.now,
    logger = silent,
  } = {}) {
    super();
    this.connectFn = connect;
    this.timers = timers;
    this.now = now;
    this.logger = logger;
    this.options = { host: '', port: 0 };
    this.socket = undefined;
    this.generation = 0;
    this.running = false;
    this.ready = false;
    this.failures = 0;
    this.closedAt = undefined;
    this.queue = [];
    this.inflight = undefined;
    this.reconnectTimer = undefined;
    this.connectTimer = undefined;
    this.ticker = undefined;
    this.uncertainUntil = 0;
    this.pendingLate = 0;
    this.ackOwedUntil = 0;
    this.drops = { count: 0, reasons: {}, loggedAt: undefined };
    this.dropRun = 0;
    this.nextAttemptAt = undefined;
  }

  configure({ host, port }) {
    this.options = { host, port };
  }

  get connected() {
    return this.ready;
  }

  /** A socket is open (connecting, starting or up). */
  get busy() {
    return Boolean(this.socket);
  }

  /** A late answer (of a command that timed out, or got an ambiguous one) may still come. */
  get uncertain() {
    if (this.pendingLate > 0 && this.now() >= this.uncertainUntil) this.pendingLate = 0;
    return this.pendingLate > 0;
  }

  /**
   * Starts; the first connection waits until `notBefore` (the instant of the
   * last attempt, kept in /data across restarts, plus its wait).
   */
  start({ notBefore = 0, failures = 0 } = {}) {
    this.stop();
    this.running = true;
    this.failures = failures;
    this.openSoon(Math.max(0, notBefore - this.now()));
  }

  /** Opens after `wait`, never sooner than sessionGap after the last connection closed. */
  openSoon(wait) {
    const gap = this.closedAt === undefined ? 0 : this.closedAt + TIMINGS.sessionGap - this.now();
    const delay = Math.max(wait, gap, 0);
    this.nextAttemptAt = this.now() + delay;
    if (delay === 0) {
      this.open();
      return;
    }
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.running && !this.socket) this.open();
    }, delay);
  }

  /**
   * A protective command (an arm) while the client waits between two
   * attempts: one attempt now, outside the waits. Returns whether one was
   * started (never a second socket).
   */
  wake() {
    if (!this.running || this.socket) return false;
    if (this.reconnectTimer) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.open();
    return true;
  }

  stop() {
    this.running = false;
    this.generation += 1;
    if (this.reconnectTimer) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.nextAttemptAt = undefined;
    this.close();
  }

  /** Ends the socket; every waiting request fails (sent or not, as it was). */
  close() {
    if (this.connectTimer) this.timers.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    if (this.ticker) this.timers.clearInterval(this.ticker);
    this.ticker = undefined;
    if (this.owedTimer) this.timers.clearTimeout(this.owedTimer);
    this.owedTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    const inflight = this.inflight;
    this.inflight = undefined;
    if (inflight) {
      this.timers.clearTimeout(inflight.timer);
      inflight.reject(
        new VisonicError('The connection to the panel ended', 'lost', { sent: inflight.written }),
      );
    }
    for (const entry of this.queue.splice(0)) {
      this.timers.clearTimeout(entry.deadline);
      entry.reject(new VisonicError('Not connected to the panel', 'offline'));
    }
    if (!socket) return;
    this.closedAt = this.now();
    socket.removeAllListeners();
    socket.on('error', () => undefined);
    socket.destroy();
  }

  // --- Connection -------------------------------------------------------------

  open() {
    const generation = this.generation;
    const { host, port } = this.options;
    this.nextAttemptAt = undefined;
    this.timeouts = 0;
    this.uncertainUntil = 0;
    this.pendingLate = 0;
    this.ackOwedUntil = 0;
    this.dropRun = 0;
    this.keepAlives = 0;
    this.second = { at: this.now(), frames: 0 };
    this.frames = new FrameReader({
      gap: TIMINGS.frameGap,
      onFrame: (frame) => {
        if (generation !== this.generation) return;
        this.dropRun = 0;
        this.frame(generation, frame);
      },
      onDrop: (why, { type }) => this.rejected(generation, why, type),
    });
    this.emit('attempt', { at: this.now() });
    this.logger.debug(`Connecting to the adapter at ${host}:${port}`);
    let socket;
    try {
      socket = this.connectFn({ host, port });
    } catch (err) {
      this.lost(generation, `connection failed: ${err.message}`);
      return;
    }
    this.socket = socket;
    socket.setNoDelay?.(true);
    this.connectTimer = this.timers.setTimeout(
      () => this.lost(generation, 'connection timed out'),
      TIMINGS.connectTimeout,
    );
    socket.on('connect', () => {
      if (generation !== this.generation) return;
      this.timers.clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
      this.lastReceived = this.now();
      this.lastSent = this.now();
      this.run(generation);
    });
    socket.on('data', (chunk) => {
      if (generation !== this.generation) return;
      this.lastReceived = this.now();
      this.frames.push(chunk, this.now());
    });
    socket.on('error', (err) => this.lost(generation, err.code ?? err.message));
    socket.on('close', () => this.lost(generation, 'connection closed by the adapter'));
  }

  /** The session ended: reconnect later, unless stopped. */
  lost(generation, reason, { silent: silentStart = false } = {}) {
    if (generation !== this.generation) return;
    this.generation += 1;
    const wasUp = this.ready;
    this.close();
    if (!this.running) return;
    this.failures = wasUp ? 1 : this.failures + 1;
    const retryIn = TIMINGS.backoff[Math.min(this.failures - 1, TIMINGS.backoff.length - 1)];
    this.openSoon(retryIn);
    this.emit('down', { reason, retryIn, wasUp, silent: silentStart, failures: this.failures });
  }

  /** The first status request proves the link: 'up' once a checksum-checked status came. */
  async run(generation) {
    try {
      let status;
      try {
        status = await this.request(STATUS_ALL, {
          internal: true,
          label: 'status',
          expect: 'system',
          timeout: TIMINGS.firstStatusTimeout,
        });
      } catch (err) {
        if (err instanceof VisonicError && err.kind === 'timeout') {
          this.lost(generation, 'no status from the panel', { silent: true });
          return;
        }
        throw err;
      }
      if (generation !== this.generation) return;
      this.ticker = this.timers.setInterval(() => this.tick(generation), 1_000);
      this.ready = true;
      this.failures = 0;
      this.emit('up', { status });
    } catch (err) {
      if (generation !== this.generation) return;
      this.lost(generation, err.message);
    }
  }

  tick(generation) {
    if (generation !== this.generation || !this.socket) return;
    const now = this.now();
    this.logDrops();
    if (now - this.lastReceived > TIMINGS.watchdog) {
      this.logger.warn('Visonic: nothing received for too long, reconnecting');
      this.lost(generation, 'no answer from the panel');
      return;
    }
    if (!this.inflight && this.queue.length === 0 && now - this.lastSent >= TIMINGS.keepAlive) {
      this.keepAlives += 1;
      const full = this.keepAlives % FULL_STATUS_EVERY === 0;
      this.request(full ? STATUS_ALL : STATUS_SYSTEM, {
        label: 'keep-alive status',
        expect: 'system',
      }).catch(() => undefined);
    }
  }

  // --- Frames -----------------------------------------------------------------

  /**
   * A frame or a malformed one. The first one of a period is logged, the
   * others counted and summed up once per period; too many in a row without
   * a good frame cut the connection. A malformed frame of a type that wants
   * an acknowledge still gets one (pyvisonic: so the panel does not stall).
   */
  rejected(generation, why, type) {
    if (generation !== this.generation) return;
    if (type !== undefined && needsAck(type)) this.writeAck(generation);
    const drops = this.drops;
    drops.count += 1;
    drops.reasons[why] = (drops.reasons[why] ?? 0) + 1;
    this.dropRun += 1;
    if (drops.loggedAt === undefined) {
      this.logger.warn(`Visonic: ${why}, dropped`);
      drops.loggedAt = this.now();
      drops.count = 0;
      drops.reasons = {};
    } else {
      this.logDrops();
    }
    if (this.dropRun >= LIMITS.maxRejects) {
      this.logDrops(true);
      this.lost(generation, 'too many malformed frames from the adapter');
    }
  }

  logDrops(now = false) {
    const drops = this.drops;
    if (drops.count === 0 || drops.loggedAt === undefined) return;
    if (!now && this.now() - drops.loggedAt < TIMINGS.rejectLog) return;
    const reasons = Object.entries(drops.reasons)
      .map(([why, n]) => `${n} ${why}`)
      .join(', ');
    this.logger.warn(`Visonic: ${drops.count} frame(s) dropped (${reasons})`);
    drops.count = 0;
    drops.reasons = {};
    drops.loggedAt = this.now();
  }

  /** Too many frames in one second: a flood or a loop, not a panel. */
  flooding(generation) {
    const now = this.now();
    if (now - this.second.at >= 1_000) this.second = { at: now, frames: 0 };
    this.second.frames += 1;
    if (this.second.frames <= LIMITS.maxFramesPerSecond) return false;
    this.logger.warn('Visonic: too many frames per second, connection cut');
    this.lost(generation, 'too many frames from the adapter');
    return true;
  }

  frame(generation, { type, data }) {
    if (this.flooding(generation)) return;
    if (needsAck(type)) this.writeAck(generation);
    if (generation !== this.generation) return;
    if (type === TYPE.STATUS) {
      const status = decodeStatus(data);
      if (!status) {
        this.rejected(generation, 'short status message');
        return;
      }
      // Before 'up' too: the zone messages of the first status come before A5 04.
      this.emit('status', status);
      if (status.system) this.answer('system', status.system);
      return;
    }
    if (type === TYPE.EVENTS) {
      const events = decodeEvents(data);
      if (events.length > 0) this.emit('events', events);
      return;
    }
    if (type === TYPE.ACK) {
      this.answer('ack');
      return;
    }
    if (type === TYPE.ACCESS_DENIED) {
      this.answer('denied');
      return;
    }
    if (type === TYPE.LOOPBACK) {
      this.logger.warn('Visonic: 0x0B received (an adapter that echoes, or a stop of the panel)');
      return;
    }
    this.logger.debug(`Visonic: message ${hex(type)} not used`);
  }

  /** Our acknowledge, written at once, outside the queue. */
  writeAck(generation) {
    if (generation !== this.generation || !this.socket) return;
    try {
      this.socket.write(encodeFrame(ACK));
    } catch (err) {
      this.lost(generation, err.message);
    }
  }

  /**
   * An answer for the request in flight, if it is the one it waits for.
   * `system`: a status reply; `ack` / `denied`: what a command waits for.
   */
  answer(kind, value) {
    const entry = this.inflight;
    if (kind === 'ack' && entry?.expect === 'system') {
      entry.ackSeen = true;
      return;
    }
    if (kind === 'ack' && !entry) {
      // The acknowledge of a status request, or a late one of a command.
      this.ackOwedUntil = 0;
      if (this.pendingLate > 0) this.pendingLate -= 1;
      return;
    }
    if (kind === 'denied' && entry?.expect !== 'ack') {
      // Never an answer to a status request: a late answer of a command.
      if (this.pendingLate > 0) this.pendingLate -= 1;
      this.emit('denied', {});
      return;
    }
    if (!entry || entry.expect !== (kind === 'system' ? 'system' : 'ack')) return;
    this.timers.clearTimeout(entry.timer);
    this.inflight = undefined;
    this.timeouts = 0;
    if (kind === 'system') {
      // Its acknowledge may come after the status: a command written now
      // would take it for its own.
      if (!entry.ackSeen) this.ackOwedUntil = this.now() + ACK_OWED;
      entry.resolve(value);
    } else if (this.uncertain) {
      // It may answer an earlier command; this one's answer may still come.
      this.uncertainUntil = this.now() + TIMINGS.uncertain;
      const err = new VisonicError(`Ambiguous answer to ${entry.label}`, 'ambiguous', {
        sent: true,
      });
      // A denial, of this command or of the one before: a refused code either way.
      err.denied = kind === 'denied';
      entry.reject(err);
    } else if (kind === 'ack') {
      entry.resolve('ack');
    } else {
      entry.reject(
        new VisonicError('The panel answered "access denied"', 'denied', { sent: true }),
      );
    }
    this.pump();
  }

  // --- Requests ---------------------------------------------------------------

  /**
   * Queues a request; resolves with the system status (`expect: 'system'`)
   * or 'ack' (`expect: 'ack'`). `label` replaces the bytes in the logs (a
   * command holds the user code). `sendBy` (a time): never written after it.
   * `answerBy` (a time): the answer is awaited up to it. `check()`: run right
   * before the write, false withdraws the request (nothing sent). `first`:
   * goes ahead of the queue (a protective command). `kind`: a tag that
   * `withdraw()` can match.
   */
  request(
    bytes,
    {
      expect,
      timeout = TIMINGS.requestTimeout,
      label = 'request',
      internal = false,
      sendBy,
      answerBy,
      check,
      onWrite,
      first = false,
      kind,
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      if (!this.socket || (!internal && !this.ready)) {
        reject(new VisonicError('Not connected to the panel', 'offline'));
        return;
      }
      const entry = {
        bytes,
        expect,
        label,
        timeout,
        answerBy,
        check,
        onWrite,
        kind,
        resolve,
        reject,
        written: false,
      };
      if (sendBy !== undefined) {
        const wait = sendBy - this.now();
        if (wait <= 0) {
          reject(new VisonicError(`${label} not sent in time`, 'late'));
          return;
        }
        // Withdrawn at its deadline if the line is still busy: never written late.
        entry.deadline = this.timers.setTimeout(() => {
          const at = this.queue.indexOf(entry);
          if (at < 0) return;
          this.queue.splice(at, 1);
          reject(new VisonicError(`${label} not sent in time`, 'late'));
          this.pump();
        }, wait);
      }
      if (first) this.queue.unshift(entry);
      else this.queue.push(entry);
      this.pump();
    });
  }

  /** Withdraws the queued (never the written) requests of a kind; how many. */
  withdraw(kind) {
    let count = 0;
    for (const entry of [...this.queue]) {
      if (entry.kind !== kind) continue;
      this.queue.splice(this.queue.indexOf(entry), 1);
      this.timers.clearTimeout(entry.deadline);
      entry.reject(new VisonicError(`${entry.label} withdrawn`, 'withdrawn'));
      count += 1;
    }
    return count;
  }

  pump() {
    if (this.inflight || this.queue.length === 0 || !this.socket) return;
    const entry = this.queue[0];
    const owed = this.ackOwedUntil - this.now();
    if (entry.expect === 'ack' && owed > 0) {
      // The acknowledge of the last status request may still come: wait for
      // it (or for ACK_OWED), so it never passes for this command's.
      if (!this.owedTimer) {
        this.owedTimer = this.timers.setTimeout(() => {
          this.owedTimer = undefined;
          this.ackOwedUntil = 0;
          this.pump();
        }, owed);
      }
      return;
    }
    this.queue.shift();
    this.timers.clearTimeout(entry.deadline);
    const generation = this.generation;
    // Last look before the socket: a command whose check fails (option off,
    // code changed, deadline passed) is withdrawn, never written.
    if (entry.check && !entry.check()) {
      entry.reject(new VisonicError(`${entry.label} withdrawn before the write`, 'withdrawn'));
      this.pump();
      return;
    }
    const bytes = encodeFrame(entry.bytes);
    this.inflight = entry;
    this.logger.debug(`Visonic <- ${entry.label}`);
    entry.written = true;
    this.lastSent = this.now();
    const wait =
      entry.answerBy === undefined ? entry.timeout : Math.max(200, entry.answerBy - this.now());
    try {
      entry.onWrite?.();
    } catch {
      // A bookkeeping callback never stops the write.
    }
    try {
      this.socket.write(bytes);
    } catch (err) {
      this.lost(generation, err.message);
      return;
    }
    if (this.overflowing(generation)) return;
    entry.timer = this.timers.setTimeout(() => {
      if (this.inflight !== entry) return;
      this.inflight = undefined;
      this.timeouts += 1;
      if (entry.expect === 'ack') {
        // A late answer may still come: for a while, an answer is not trusted.
        this.pendingLate += 1;
        this.uncertainUntil = this.now() + TIMINGS.uncertain;
      }
      entry.reject(new VisonicError(`No answer to ${entry.label}`, 'timeout', { sent: true }));
      if (this.timeouts >= LIMITS.maxTimeouts) {
        this.lost(generation, 'no answer from the panel');
        return;
      }
      this.pump();
    }, wait);
  }

  /** A peer that never reads what we write: cut. */
  overflowing(generation) {
    if ((this.socket?.writableLength ?? 0) <= LIMITS.maxPendingWrite) return false;
    this.logger.warn('Visonic: too much data waiting to be written, connection cut');
    this.lost(generation, 'write buffer full');
    return true;
  }

  // --- Reads and commands ---------------------------------------------------

  /** The system status (A5 04) read now. */
  readStatus(options = {}) {
    return this.request(STATUS_SYSTEM, { label: 'status', expect: 'system', ...options });
  }

  /** Every status message (zones too); resolves with the system status. */
  readAll(options = {}) {
    return this.request(STATUS_ALL, { label: 'full status', expect: 'system', ...options });
  }

  /** Arm (armed_away, armed_stay) or disarm (disarmed); the user code goes in the frame, never in a log. */
  command(mode, code, options = {}) {
    return this.request(armFrame(mode, code), {
      label: mode === 'disarmed' ? 'disarm' : `arm (${mode})`,
      expect: 'ack',
      ...options,
    });
  }
}
