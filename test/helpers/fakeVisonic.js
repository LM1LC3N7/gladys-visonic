// -----------------------------------------------------------------------------
// An in-memory Visonic panel behind its serial-to-network adapter: no socket,
// no network. `connect` is given to the client in place of
// net.createConnection; each call opens a connection that behaves as
// pyvisonic describes a PowerMax in Standard mode: the acknowledge of every
// request, the A5 status messages (01 to 06, or 04 only), the acknowledge or
// "access denied" (08) of an A1 command, the A5 04 sent by itself on a change,
// and the A7 events. It records every frame the client sent, our
// acknowledges included.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { FrameReader, encodeFrame, encodeMask } from '../../src/visonic/frame.js';

/** Lets every queued delivery and the promise chains behind it run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits until `check()` is true, at most `timeout` ms. */
export async function until(check, timeout = 6_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await settle(5);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never met');
}

/** The system status codes used by the tests (pyvisonic pmPanelArmedStatus). */
export const SYS = {
  DISARMED: 0x00,
  ARMING_STAY: 0x01,
  ARMING_AWAY: 0x02,
  ENTRY: 0x03,
  ARMED_STAY: 0x04,
  ARMED_AWAY: 0x05,
  INSTALLER: 0x09,
};

class FakeSocket extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.destroyed = false;
    this.writableLength = 0;
    this.reader = new FrameReader({
      onFrame: (frame) => server.receive(this, frame),
      onDrop: (why) => server.drops.push(why),
    });
  }

  setNoDelay() {}

  write(bytes) {
    if (this.destroyed) throw new Error('write after destroy');
    const copy = Buffer.from(bytes);
    queueMicrotask(() => {
      if (!this.destroyed) this.reader.push(copy);
    });
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    queueMicrotask(() => this.emit('close'));
  }

  /** Panel side: a frame to the client (type + data). */
  send(bytes) {
    this.raw(encodeFrame(bytes));
  }

  raw(bytes) {
    const copy = Buffer.from(bytes);
    queueMicrotask(() => {
      if (!this.destroyed) this.emit('data', copy);
    });
  }
}

export class FakePanel {
  constructor({ code = '1234', exitDelay = false, silent = false, refuseConnections = 0 } = {}) {
    this.code = code;
    this.exitDelay = exitDelay;
    this.silent = silent;
    this.refuseConnections = refuseConnections;
    this.sysStatus = SYS.DISARMED;
    this.sysFlags = 0x01; // ready
    this.zones = { open: new Set(), battery: new Set(), tamper: new Set(), trip: new Set() };
    this.bypass = new Set();
    /** Push A5 04 by itself after an accepted command. */
    this.pushChanges = true;
    /** Answer an accepted command with the state unchanged (a zone open). */
    this.ignoreCommands = false;
    /** The acknowledge of a status request comes after the status (owed acknowledge). */
    this.ackLast = false;
    this.sockets = [];
    /** Every frame the client sent: [{ session, type, data, at }]. */
    this.log = [];
    this.drops = [];
    /** (type, data) -> true: that frame gets no answer. */
    this.hold = () => false;
    this.connect = this.connect.bind(this);
  }

  connect(options) {
    this.options = options;
    const socket = new FakeSocket(this);
    socket.session = this.sockets.length + 1;
    this.sockets.push(socket);
    if (this.refuseConnections > 0) {
      this.refuseConnections -= 1;
      queueMicrotask(() => {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        socket.emit('error', err);
      });
      return socket;
    }
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  }

  get current() {
    return this.sockets.at(-1);
  }

  /** The A1 command frames, every session. */
  get commands() {
    return this.log.filter((e) => e.type === 0xa1);
  }

  /** The status requests (A2), every session. */
  get statusRequests() {
    return this.log.filter((e) => e.type === 0xa2);
  }

  /** Our acknowledges received. */
  get acks() {
    return this.log.filter((e) => e.type === 0x02).length;
  }

  receive(socket, { type, data }) {
    this.log.push({ session: socket.session, type, data, at: Date.now() });
    if (type === 0x02 || this.silent || this.hold(type, data)) return;
    if (type === 0xa2) {
      const which = data[2];
      if (!this.ackLast) socket.send([0x02]);
      if (which === 0x3f) {
        for (const subtype of [0x01, 0x02, 0x03]) socket.send(this.masks(subtype));
      }
      socket.send(this.system());
      if (which === 0x3f) socket.send(this.masks(0x06));
      if (this.ackLast) socket.send([0x02]);
      return;
    }
    if (type === 0xa1) {
      this.command(socket, data);
    }
  }

  command(socket, data) {
    const code = `${data[3].toString(16).padStart(2, '0')}${data[4].toString(16).padStart(2, '0')}`;
    if (code !== this.code) {
      socket.send([0x08]);
      return;
    }
    socket.send([0x02]);
    if (this.ignoreCommands) return;
    const mode = data[2];
    if (mode === 0x00) this.sysStatus = SYS.DISARMED;
    else if (mode === 0x05) this.sysStatus = this.exitDelay ? SYS.ARMING_AWAY : SYS.ARMED_AWAY;
    else if (mode === 0x04) this.sysStatus = this.exitDelay ? SYS.ARMING_STAY : SYS.ARMED_STAY;
    if (mode === 0x00) this.sysFlags &= ~0x80;
    if (this.pushChanges) this.push();
  }

  /** A5 04: [count, 04, status, flags, zone, event, 0, 0, switches, 43]. */
  system(zoneEvent) {
    const flags = this.sysFlags | (zoneEvent ? 0x20 : 0);
    return [
      0xa5,
      0x00,
      0x04,
      this.sysStatus,
      flags,
      zoneEvent?.zone ?? 0,
      zoneEvent?.event ?? 0,
      0,
      0,
      0,
      0,
      0x43,
    ];
  }

  masks(subtype) {
    const pairs = {
      0x01: [this.zones.trip, new Set()],
      0x02: [this.zones.open, this.zones.battery],
      0x03: [new Set(), this.zones.tamper],
      0x06: [new Set([1, 2, 3, 4, 5, 6, 7, 8]), this.bypass],
    }[subtype];
    return [0xa5, 0x00, subtype, ...encodeMask(pairs[0]), ...encodeMask(pairs[1]), 0x43];
  }

  /** A change on the panel side, sent as A5 04 (with a zone event, maybe). */
  push(zoneEvent) {
    this.current?.send(this.system(zoneEvent));
  }

  /** A5 02 sent by itself (a door opened). */
  pushMasks(subtype = 0x02) {
    this.current?.send(this.masks(subtype));
  }

  /** A7 with up to 4 events: [count, 0, (zone, type)…]. */
  events(pairs) {
    const bytes = [0xa7, pairs.length, 0x00];
    for (let i = 0; i < 4; i += 1) bytes.push(...(pairs[i] ?? [0, 0]));
    bytes.push(0x43);
    this.current?.send(bytes);
  }

  /** The adapter closes the connection. */
  drop() {
    this.current.destroy();
  }
}

export const quietLogger = () => {
  const lines = [];
  const log = (level) => (message) => lines.push(`${level} ${message}`);
  return {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
};
