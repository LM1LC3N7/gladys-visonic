// -----------------------------------------------------------------------------
// The frames of the Visonic PowerMax / PowerMaster serial protocol (no public
// description: the layout below comes from pyvisonic 4.0.8, MIT, see
// THIRD_PARTY_NOTICES.md): `py_checksum.py` (the checksum and its tolerated
// variants), `py_types_receiving.py` (the length of each message type, which
// ones the panel wants acknowledged), `py_visonic_protocol_base.py` (how the
// bytes are cut into frames), `py_visonic_despatcher.py` (how a frame is
// built).
//
// Frame: 0D | type | data… | checksum | 0A. The checksum is 0xFF minus the
// sum of type + data modulo 0xFF (0xFF itself sent as 0x00). There is no
// escape: 0A may appear inside the data, so the end of a frame is found from
// the length of its type, or, for the short control messages and the types
// this integration does not know, from the first 0A that closes a frame with
// a right checksum.
//
// Changed from pyvisonic: the reader is one linear pass over the bytes (a
// running sum, no rescan), every frame is bounded (240 bytes, pyvisonic's
// PACKET_MAX_SIZE), and an unknown type is accepted only with the exact
// checksum or its +1 variant (never the -1 one, which pyvisonic accepts for
// the known types only).
// -----------------------------------------------------------------------------

export const HEADER = 0x0d;
export const FOOTER = 0x0a;
/** The last data byte of the A* messages (pyvisonic POWERLINK_TERMINAL). */
export const TERMINAL = 0x43;

/** pyvisonic PACKET_MAX_SIZE. */
export const MAX_FRAME = 0xf0;

/** The checksum of pyvisonic `_calculate_crc`, over type + data. */
export function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum += b;
  return checksumOfSum(sum);
}

const checksumOfSum = (sum) => {
  const c = 0xff - (sum % 0xff);
  return c === 0xff ? 0 : c;
};

/**
 * Whether a received checksum byte is accepted. pyvisonic `_validate_pdu`
 * takes the checksum, the "alternative" one (always the checksum + 1), and,
 * as some panels send them, the checksum - 1. `strict`: no -1 (unknown types).
 */
export function checksumAccepted(sum, received, { strict = false } = {}) {
  const c = checksumOfSum(sum);
  if (received === c || received === c + 1) return true;
  return !strict && c > 0 && received === c - 1;
}

/** type + data -> the bytes on the wire. */
export function encodeFrame(bytes) {
  const body = [...bytes].map((b) => b & 0xff);
  return Buffer.from([HEADER, ...body, checksum(body), FOOTER]);
}

/**
 * The total length of a frame of each type, header and footer included
 * (pyvisonic pmReceiveMsg); 0: up to the first footer that closes a frame
 * with a right checksum (the short control messages).
 */
export const FIXED_LENGTHS = {
  0x02: 0, // acknowledge
  0x06: 0, // timeout
  0x07: 0, // unknown 07
  0x08: 0, // access denied
  0x0b: 0, // loopback / stop
  0x0f: 0, // exit download
  0x1f: 0,
  0x22: 14,
  0x25: 14, // download retry
  0x33: 14, // download settings
  0x3c: 14, // panel info
  0xa0: 15, // event log
  0xa3: 15, // zone names
  0xa5: 15, // status update
  0xa6: 15, // zone types
  0xa7: 15, // panel status (events)
  0xab: 15, // powerlink
  0xac: 15, // switch names
  0xad: 15, // image management
  0xe0: 11, // proxy
  0xe1: 7, // proxy command ringback
  0xf1: 9, // PowerMax+ only, its checksum is always wrong (pyvisonic ignores it)
};

/** Types whose checksum pyvisonic ignores: cut by their length, the footer checked, never read. */
const NO_CHECKSUM = new Set([0xf1, 0xf4]);

/**
 * F4 (camera images of PowerMaster panels): the length depends on the
 * subtype (byte 2): 01 is 9 bytes, 03 and 05 are 9 + the byte at index 5,
 * 15 is 12 bytes (pyvisonic pmReceiveMsg[IMAGE_DATA]); another subtype is
 * taken as 9 bytes.
 */
const F4 = {
  0x01: { base: 9 },
  0x03: { base: 9, at: 5 },
  0x05: { base: 9, at: 5 },
  0x15: { base: 12 },
};

/** The short messages that must never be lost inside a broken frame: acknowledge and access denied. */
const RESCUED = new Set([0x02, 0x08]);

/**
 * Types whose length is in the frame: total = base + the byte at `at`
 * (pyvisonic `length + int(data)` at `varlenbytepos`).
 */
export const VARIABLE_LENGTHS = {
  0x3f: { base: 7, at: 4 }, // download block
  0xb0: { base: 8, at: 4 }, // PowerMaster
  0xc0: { base: 5, at: 2 }, // redirect
};

/** The longest short control message (02 43 cs, with the header and footer). */
const MAX_SHORT = 8;

/** Types that need no acknowledge from us (pyvisonic `ackneeded` false). */
const NO_ACK = new Set([0x02, 0x0b, 0xc0, 0xe1, 0xf4]);

/** Whether the panel waits for our acknowledge of this type (unknown types too, as pyvisonic). */
export const needsAck = (type) => !NO_ACK.has(type);

/**
 * Cuts the frames out of a byte stream, in one pass. `onFrame({ type, data })`
 * gets each accepted frame (`data`: the bytes between the type and the
 * checksum); `onDrop(reason, { type })` the others. Bytes outside a frame are
 * skipped. `push(chunk, now)`: a partial frame older than `gap` ms when the
 * next chunk comes is dropped first (pyvisonic: 2 s).
 */
export class FrameReader {
  constructor({ onFrame, onDrop = () => {}, gap = 2_000 } = {}) {
    this.onFrame = onFrame;
    this.onDrop = onDrop;
    this.gap = gap;
    this.reset();
    this.lastAt = undefined;
  }

  reset() {
    this.buffer = [];
    /** Sum of every byte after the header. */
    this.sum = 0;
    /** Expected total length; 0: up to a footer with a right checksum. */
    this.expected = 0;
    /** Bounded scan for a type this reader does not know. */
    this.unknown = false;
  }

  push(chunk, now) {
    if (now !== undefined) {
      if (this.buffer.length > 0 && this.lastAt !== undefined && now - this.lastAt >= this.gap) {
        this.drop('incomplete frame');
      }
      this.lastAt = now;
    }
    for (const b of chunk) this.byte(b);
  }

  drop(reason) {
    const type = this.buffer[1];
    this.reset();
    this.onDrop(reason, { type });
  }

  byte(b) {
    const buffer = this.buffer;
    if (buffer.length === 0) {
      if (b === HEADER) buffer.push(b);
      return;
    }
    if (buffer.length === 1) {
      // pyvisonic: types 00 and FD are skipped (PowerMax Pocket, PowerMaster 10).
      if (b === 0x00 || b === 0xfd) {
        this.reset();
        return;
      }
      buffer.push(b);
      this.sum = b;
      if (b in FIXED_LENGTHS) this.expected = FIXED_LENGTHS[b];
      else if (b in VARIABLE_LENGTHS) this.expected = VARIABLE_LENGTHS[b].base;
      else if (b === 0xf4) this.expected = F4[0x01].base;
      else this.unknown = true;
      return;
    }
    buffer.push(b);
    this.sum += b;
    const type = buffer[1];
    const index = buffer.length - 1;
    const variable = type === 0xf4 ? F4[buffer[2]] : VARIABLE_LENGTHS[type];
    if (type === 0xf4 && index === 2) this.expected = (F4[b] ?? F4[0x01]).base;
    if (variable?.at !== undefined && index === variable.at) {
      this.expected = variable.base + b;
    }
    if (this.expected > 0) {
      if (buffer.length >= this.expected) this.finish();
      return;
    }
    if (b === FOOTER && buffer.length >= 4 && this.valid(this.unknown)) {
      this.emit();
      return;
    }
    if (this.unknown && b === FOOTER && this.tailIsShort()) {
      // A frame of an unknown type never swallows an acknowledge or a denial.
      const short = buffer.slice(-4);
      this.drop('unknown frame cut by a short message');
      this.onFrame({ type: short[1], data: Buffer.alloc(0) });
      return;
    }
    if (b === FOOTER && !this.unknown && buffer.length >= 4) {
      // A known short message closed by a footer with a wrong checksum.
      this.drop('wrong checksum');
      return;
    }
    if (buffer.length >= (this.unknown ? MAX_FRAME : MAX_SHORT)) {
      this.drop(this.unknown ? 'unknown frame too long' : 'frame too long');
    }
  }

  /** The last 4 bytes are a whole acknowledge or access denied (0D 02|08 cs 0A, exact checksum). */
  tailIsShort() {
    const buffer = this.buffer;
    const n = buffer.length;
    if (n <= 4) return false;
    const [header, type, cs, footer] = buffer.slice(n - 4);
    return (
      header === HEADER && RESCUED.has(type) && footer === FOOTER && cs === checksumOfSum(type)
    );
  }

  /** The acknowledges and denials inside a broken frame (one more pass over it, bounded). */
  rescue(bytes) {
    const found = [];
    for (let i = 2; i + 3 < bytes.length; i += 1) {
      const [header, type, cs, footer] = bytes.slice(i, i + 4);
      if (
        header === HEADER &&
        RESCUED.has(type) &&
        footer === FOOTER &&
        cs === checksumOfSum(type)
      ) {
        found.push(type);
        i += 3;
      }
    }
    return found;
  }

  /** The last byte is a footer and the checksum before it is accepted. */
  valid(strict) {
    const buffer = this.buffer;
    const n = buffer.length;
    if (buffer[n - 1] !== FOOTER) return false;
    const received = buffer[n - 2];
    // sum = type + data + checksum + footer.
    return checksumAccepted(this.sum - received - FOOTER, received, { strict });
  }

  finish() {
    const buffer = this.buffer;
    if (NO_CHECKSUM.has(buffer[1]) ? buffer.at(-1) === FOOTER : this.valid(false)) {
      this.emit();
      return;
    }
    const rescued = this.rescue(buffer);
    this.drop(buffer.at(-1) === FOOTER ? 'wrong checksum' : 'frame of a wrong length');
    for (const type of rescued) this.onFrame({ type, data: Buffer.alloc(0) });
  }

  emit() {
    const buffer = this.buffer;
    const type = buffer[1];
    const data = Buffer.from(buffer.slice(2, -2));
    this.reset();
    this.onFrame({ type, data });
  }
}

/** A 32-bit little-endian mask (pyvisonic b2i) -> the set of zones (bit 0 = zone 1). */
export function decodeMask(bytes) {
  const set = new Set();
  for (let i = 0; i < bytes.length && i < 4; i += 1) {
    for (let bit = 0; bit < 8; bit += 1) if (bytes[i] & (1 << bit)) set.add(i * 8 + bit + 1);
  }
  return set;
}

/** Zones 1..32 -> a 4-byte mask (the tests' panel). */
export function encodeMask(zones) {
  const out = Buffer.alloc(4);
  for (const n of zones) {
    if (!Number.isInteger(n) || n < 1 || n > 32) throw new RangeError(`zone ${n} out of a mask`);
    out[(n - 1) >> 3] |= 1 << ((n - 1) & 7);
  }
  return out;
}
