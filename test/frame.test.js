// The frames and their meaning: pyvisonic's own fixed vectors (tests/
// test_checksums.py, tests/test_protocol.py), the cutting of a byte stream in
// one bounded pass, and the decoding of the status and event messages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameReader,
  MAX_FRAME,
  checksum,
  checksumAccepted,
  decodeMask,
  encodeFrame,
  encodeMask,
  needsAck,
} from '../src/visonic/frame.js';
import {
  ARM_CODES,
  armFrame,
  decodeEvents,
  decodeStatus,
  encodeUserCode,
  eventMeaning,
  systemStatus,
} from '../src/visonic/protocol.js';

const hex = (text) => Buffer.from(text.replace(/\s+/g, ''), 'hex');

function reader() {
  const frames = [];
  const drops = [];
  const r = new FrameReader({
    onFrame: (frame) => frames.push(frame),
    onDrop: (why, info) => drops.push([why, info.type]),
  });
  return { r, frames, drops };
}

test('checksum: the vectors of pyvisonic', () => {
  const vectors = [
    ['02', 0xfd],
    ['06', 0xf9],
    ['ff', 0x00],
    ['ff ff 02', 0xfd],
    ['', 0x00],
  ];
  for (const [body, expected] of vectors) {
    assert.equal(checksum(hex(body)), expected, body);
    // The "alternative" checksum of pyvisonic is always one more.
    const sum = [...hex(body)].reduce((a, b) => a + b, 0);
    assert.ok(checksumAccepted(sum, expected + 1));
  }
  // 0d 02 fc 0a: the "one less" variant is accepted for a known type only.
  assert.ok(checksumAccepted(2, 0xfc));
  assert.ok(!checksumAccepted(2, 0xfc, { strict: true }));
  assert.ok(!checksumAccepted(2, 0x80));
  assert.deepEqual(encodeFrame([0x02]), hex('0d 02 fd 0a'));
});

test('reader: the control messages of pyvisonic, fragmented, coalesced, with noise', () => {
  const { r, frames } = reader();
  for (const packet of ['0d 02 fd 0a', '0d 02 fe 0a', '0d 02 fc 0a', '0d 08 f7 0a']) {
    r.push(hex(packet));
  }
  assert.deepEqual(
    frames.map((f) => f.type),
    [0x02, 0x02, 0x02, 0x08],
  );
  for (const split of [1, 2, 3]) {
    const { r: r2, frames: f2 } = reader();
    const packet = hex('0d 06 f9 0a');
    r2.push(packet.subarray(0, split));
    assert.equal(f2.length, 0);
    r2.push(packet.subarray(split));
    assert.equal(f2.length, 1);
  }
  const { r: r3, frames: f3 } = reader();
  r3.push(hex('ff ff 0d 06 f9 0a 0d 08 f7 0a'));
  assert.deepEqual(
    f3.map((f) => f.type),
    [0x06, 0x08],
  );
  // The Powerlink acknowledge (02 43) too.
  const { r: r4, frames: f4 } = reader();
  r4.push(encodeFrame([0x02, 0x43]));
  assert.deepEqual(f4[0], { type: 0x02, data: Buffer.from([0x43]) });
});

test('reader: a corrupt frame is dropped and the next one read', () => {
  const { r, frames, drops } = reader();
  r.push(hex('0d 06 80 0a'));
  assert.equal(frames.length, 0);
  assert.deepEqual(drops, [['wrong checksum', 0x06]]);
  r.push(hex('0d 06 f9 0a'));
  assert.equal(frames.length, 1);
});

test('reader: a status message holding 0A in its data is cut by its length', () => {
  const { r, frames } = reader();
  const status = [0xa5, 0x00, 0x02, 0x0a, 0x0a, 0x00, 0x00, 0x0a, 0, 0, 0, 0x43];
  r.push(encodeFrame(status));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, 0xa5);
  assert.equal(frames[0].data.length, 11);
  assert.deepEqual([...decodeStatus(frames[0].data).masks.open], [2, 4, 10, 12]);
});

test('reader: variable lengths (B0), unknown types bounded, stale partial frames dropped', () => {
  const { r, frames, drops } = reader();
  // B0: total = 8 + the byte at index 4 (0d b0 03 <subtype> <length> <data…> 43 cs 0a).
  const b0 = [0xb0, 0x03, 0x24, 0x03, 0x01, 0x0a, 0x03, 0x43];
  r.push(encodeFrame(b0));
  assert.deepEqual(frames.at(-1), { type: 0xb0, data: Buffer.from(b0.slice(1)) });
  // An unknown type with no right footer: dropped at MAX_FRAME, never more.
  r.push(Buffer.from([0x0d, 0x99, ...Array(MAX_FRAME).fill(0x11)]));
  assert.equal(drops.at(-1)[0], 'unknown frame too long');
  r.push(hex('0d 06 f9 0a'));
  assert.equal(frames.at(-1).type, 0x06);
  // A partial frame older than 2 s when the next chunk comes.
  const timed = reader();
  timed.r.push(hex('0d a5 00'), 1_000);
  timed.r.push(hex('0d 06 f9 0a'), 3_500);
  assert.deepEqual(timed.drops, [['incomplete frame', 0xa5]]);
  assert.deepEqual(
    timed.frames.map((f) => f.type),
    [0x06],
    'the new chunk starts afresh',
  );
});

test('reader: one linear pass over a large hostile stream', () => {
  const { r, frames } = reader();
  const junk = Buffer.alloc(2_000_000, 0x0d);
  const start = process.hrtime.bigint();
  r.push(junk);
  r.push(Buffer.alloc(2_000_000, 0x0a));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 2_000, `${ms} ms`);
  assert.ok(r.buffer.length <= MAX_FRAME);
  assert.equal(frames.length, 0);
});

test('acknowledges: what the panel waits for (pyvisonic ackneeded)', () => {
  for (const type of [0xa5, 0xa7, 0x08, 0x06, 0x3c, 0xb0, 0x77]) assert.ok(needsAck(type), type);
  for (const type of [0x02, 0x0b, 0xc0, 0xf4]) assert.ok(!needsAck(type), type);
});

test('masks: little-endian, bit 0 is zone 1', () => {
  assert.deepEqual([...decodeMask(Buffer.from([0x01, 0x80, 0, 0x80]))], [1, 16, 32]);
  assert.deepEqual(encodeMask([1, 16, 32]), Buffer.from([0x01, 0x80, 0, 0x80]));
  assert.throws(() => encodeMask([33]), RangeError);
});

test('commands: the A1 frame of pyvisonic, the code as two BCD bytes', () => {
  assert.deepEqual(encodeUserCode('1234'), [0x12, 0x34]);
  assert.deepEqual(encodeUserCode('0905'), [0x09, 0x05]);
  for (const bad of ['123', '12345', '12a4', '', null]) {
    assert.throws(() => encodeUserCode(bad), RangeError);
  }
  assert.deepEqual(
    armFrame('armed_away', '1234'),
    [0xa1, 0, 0, 0x05, 0x12, 0x34, 0x07, 0, 0, 0, 0, 0x43],
  );
  assert.equal(armFrame('disarmed', '1234')[3], ARM_CODES.disarmed);
  assert.equal(armFrame('armed_stay', '1234')[3], 0x04);
  assert.throws(() => armFrame('armed_night', '1234'), RangeError);
});

test('system status: pyvisonic pmPanelArmedStatus and the flags', () => {
  assert.equal(systemStatus(0x00, 0x01).mode, 'disarmed');
  assert.equal(systemStatus(0x00, 0x01).ready, true);
  assert.deepEqual(
    [systemStatus(0x02, 0).mode, systemStatus(0x02, 0).arming],
    ['arming', 'armed_away'],
  );
  assert.equal(systemStatus(0x05, 0).mode, 'armed_away');
  assert.equal(systemStatus(0x14, 0).mode, 'armed_stay');
  assert.equal(systemStatus(0x0b, 0).mode, 'armed_away', 'armed away with zones bypassed');
  assert.equal(systemStatus(0x00, 0x08).bypass, true);
  assert.equal(systemStatus(0x03, 0).entry, true);
  assert.equal(systemStatus(0x09, 0).mode, 'programming');
  assert.equal(systemStatus(0x0e, 0).mode, 'unknown');
  // Bit 0x20 of the status is masked as pyvisonic does without partitions.
  assert.equal(systemStatus(0x25, 0).mode, 'armed_away');
  const flags = systemStatus(0x05, 0x80 | 0x04);
  assert.deepEqual([flags.alarmEvent, flags.trouble], [true, true]);
});

test('status and event messages: decoded, short ones ignored', () => {
  const a504 = [0x00, 0x04, 0x05, 0x21, 0x03, 0x03, 0, 0, 0, 0, 0x43];
  const decoded = decodeStatus(Buffer.from(a504));
  assert.equal(decoded.system.mode, 'armed_away');
  assert.deepEqual(decoded.zoneEvent, { zone: 3, event: 3 });
  assert.equal(decodeStatus(Buffer.from([0x00, 0x04, 0x05])), undefined);
  assert.deepEqual(decodeStatus(Buffer.from([0, 0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0x43])), {
    subtype: 0x05,
  });
  assert.deepEqual(decodeEvents(Buffer.from([2, 0, 5, 0x01, 0, 0x20, 0, 0, 0, 0, 0x43])), [
    { zone: 5, type: 0x01 },
    { zone: 0, type: 0x20 },
  ]);
  assert.deepEqual(decodeEvents(Buffer.from([9, 0, 5, 1, 0, 0, 0, 0, 0, 0, 0x43])), []);
  assert.equal(decodeEvents(Buffer.from([0xff, 0x51, 0x61, 0x51, 1, 0, 0x11, 6, 0, 0])).length, 1);
  assert.equal(eventMeaning(0x20).alarm, 'fire');
  assert.equal(eventMeaning(0x01).intruder, true);
  assert.equal(eventMeaning(0x55).intruderRestore, true);
  assert.equal(eventMeaning(0x07).tamper, true);
});
