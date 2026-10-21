// -----------------------------------------------------------------------------
// What the frames mean in Standard mode (no download of the panel memory, no
// Powerlink enrolment), ported from pyvisonic 4.0.8 (MIT, see
// THIRD_PARTY_NOTICES.md): `py_types_sending.py` (the commands), `py_visonic.py`
// (the arming codes, the user code field), `py_partition_state.py` (the
// system states of A5 04 and their flags), `py_visonic_message_handling.py`
// (the A5 status messages, the A7 events), `py_enum.py` (the event types),
// `py_sensor_types.py` (the zone events of A5 04).
//
// The panel has no public protocol description: every value below is what
// pyvisonic found on real PowerMax and PowerMaster panels, nothing more.
// -----------------------------------------------------------------------------

import { TERMINAL, decodeMask } from './frame.js';

export const TYPE = {
  ACK: 0x02,
  TIMEOUT: 0x06,
  ACCESS_DENIED: 0x08,
  LOOPBACK: 0x0b,
  EXIT: 0x0f,
  ARM: 0xa1,
  STATUS_REQUEST: 0xa2,
  STATUS: 0xa5,
  EVENTS: 0xa7,
};

/** Our acknowledge of a panel message (Standard mode: never the Powerlink one, 02 43). */
export const ACK = [TYPE.ACK];

/** A2 with 0x3F: every status message, A5 01 to 06 (pyvisonic Send.STATUS). */
export const STATUS_ALL = [0xa2, 0x00, 0x00, 0x3f, 0, 0, 0, 0, 0, 0, 0, TERMINAL];
/** A2 with 0x08: the system status only, A5 04 (pyvisonic Send.STATUS_SEN). */
export const STATUS_SYSTEM = [0xa2, 0x00, 0x00, 0x08, 0, 0, 0, 0, 0, 0, 0, TERMINAL];

/** The code byte of A1 (pyvisonic pmArmMode). */
export const ARM_CODES = { disarmed: 0x00, armed_stay: 0x04, armed_away: 0x05 };

/** Every partition (pyvisonic sends 0x07 when no partition is given). */
export const ALL_PARTITIONS = 0x07;

/** The user code: exactly 4 digits (pyvisonic PIN_REGEX). */
export const isUserCode = (code) => /^\d{4}$/.test(String(code ?? ''));

/** "1234" -> [0x12, 0x34] (pyvisonic `_create_pin`). */
export function encodeUserCode(code) {
  const text = String(code ?? '');
  if (!isUserCode(text)) throw new RangeError('the user code must be 4 digits');
  return [Number.parseInt(text.slice(0, 2), 16), Number.parseInt(text.slice(2, 4), 16)];
}

/** A1 00 00 <mode> <code> <partitions> 00 00 00 00 43 (pyvisonic Send.ARM). */
export function armFrame(mode, code) {
  if (!(mode in ARM_CODES)) throw new RangeError(`unknown arming mode ${mode}`);
  return [
    TYPE.ARM,
    0x00,
    0x00,
    ARM_CODES[mode],
    ...encodeUserCode(code),
    ALL_PARTITIONS,
    0,
    0,
    0,
    0,
    TERMINAL,
  ];
}

/**
 * The system status of A5 04 (pyvisonic pmPanelArmedStatus), masked with
 * 0x1F as pyvisonic does without partitions. `armed`: a command to disarm
 * makes sense; `entry`: the entry delay runs.
 */
const SYSTEM_STATES = {
  0x00: { mode: 'disarmed' },
  0x01: { mode: 'arming', arming: 'armed_stay', armed: true },
  0x02: { mode: 'arming', arming: 'armed_away', armed: true },
  0x03: { mode: 'entry_delay', armed: true, entry: true },
  0x04: { mode: 'armed_stay', armed: true },
  0x05: { mode: 'armed_away', armed: true },
  0x06: { mode: 'disarmed' }, // user test
  0x07: { mode: 'programming' }, // downloading
  0x08: { mode: 'programming' }, // programming
  0x09: { mode: 'programming' }, // installer
  0x0a: { mode: 'armed_stay', armed: true, bypass: true },
  0x0b: { mode: 'armed_away', armed: true, bypass: true },
  0x0c: { mode: 'disarmed' }, // ready
  0x0d: { mode: 'disarmed' }, // not ready
  0x10: { mode: 'disarmed' }, // disarmed instant
  0x11: { mode: 'arming', arming: 'armed_stay', armed: true },
  0x12: { mode: 'arming', arming: 'armed_away', armed: true },
  0x13: { mode: 'entry_delay', armed: true, entry: true },
  0x14: { mode: 'armed_stay', armed: true, instant: true },
  0x15: { mode: 'armed_away', armed: true, instant: true },
};

/**
 * A5 04 -> the system state. `alarmEvent` (flag 0x80) while armed out of
 * the entry delay is how pyvisonic sees an alarm in Standard mode.
 */
export function systemStatus(sysStatus, sysFlags) {
  const state = SYSTEM_STATES[sysStatus & 0x1f] ?? { mode: 'unknown' };
  return {
    raw: sysStatus & 0x1f,
    mode: state.mode,
    arming: state.arming,
    armed: Boolean(state.armed),
    entry: Boolean(state.entry),
    ready: (sysFlags & 0x01) !== 0,
    memory: (sysFlags & 0x02) !== 0,
    trouble: (sysFlags & 0x04) !== 0,
    bypass: (sysFlags & 0x08) !== 0,
    alarmEvent: (sysFlags & 0x80) !== 0,
  };
}

/** What each A5 subtype carries in its two 4-byte masks (pyvisonic `_handle_msgtype_a5`). */
export const STATUS_MASKS = {
  0x01: ['trip', 'tamperAlarm'],
  0x02: ['open', 'battery'],
  0x03: ['inactive', 'tamper'],
  0x06: ['enrolled', 'bypass'],
};

/**
 * One A5 message: `{ subtype, system? , zoneEvent?, masks? }`; undefined when
 * it is too short. `data`: the bytes after the type (count, subtype, 8 data
 * bytes, 0x43).
 */
export function decodeStatus(data) {
  if (data.length < 10) return undefined;
  const subtype = data[1];
  if (subtype === 0x04) {
    return {
      subtype,
      system: systemStatus(data[2], data[3]),
      // Flag 0x20: the zone event in bytes 4 and 5 is new.
      zoneEvent:
        (data[3] & 0x20) !== 0 && data[5] > 0 && data[4] !== 0xff
          ? { zone: data[4], event: data[5] }
          : undefined,
    };
  }
  const names = STATUS_MASKS[subtype];
  if (!names) return { subtype };
  return {
    subtype,
    masks: {
      [names[0]]: decodeMask(data.subarray(2, 6)),
      [names[1]]: decodeMask(data.subarray(6, 10)),
    },
  };
}

/** Zone events of A5 04 (pyvisonic pmZoneEventAction): what each one changes. */
export const ZONE_EVENTS = {
  1: { tamper: true },
  2: { tamper: false },
  3: { open: true },
  4: { open: false },
  5: { motion: true },
  8: { tamper: true },
  13: { battery: true },
};

/** The A7 event types used here (pyvisonic EventType and the partition state sets). */
const INTRUDER = new Set([0x01, 0x02, 0x03, 0x04, 0x05]);
const INTRUDER_RESTORE = new Set([0x11, 0x12, 0x13, 0x14, 0x15, 0x1b, 0x1c, 0x55]);
const ALARMS = {
  0x0b: 'panic',
  0x0c: 'panic',
  0x0d: 'panic',
  0x20: 'fire',
  0x23: 'emergency',
  0x49: 'gas',
  0x4d: 'flood',
};
const ALARM_RESTORE = new Set([0x1b, 0x21, 0x24, 0x4a, 0x4e, 0x1c]);
export const ALARM_DELAY = 0x03;
const PANEL_TAMPER = new Set([0x07]);
const PANEL_TAMPER_RESTORE = new Set([0x17, 0x1b]);

/** What one A7 event says: `{ intruder, intruderRestore, alarm, alarmRestore, tamper }`. */
export function eventMeaning(type) {
  return {
    intruder: INTRUDER.has(type),
    delay: type === ALARM_DELAY,
    intruderRestore: INTRUDER_RESTORE.has(type),
    alarm: ALARMS[type],
    alarmRestore: ALARM_RESTORE.has(type),
    tamper: PANEL_TAMPER.has(type) ? true : PANEL_TAMPER_RESTORE.has(type) ? false : undefined,
  };
}

/**
 * The events of one A7 message: `[{ zone, type }]`. Count 1 to 4: pairs from
 * byte 2; count 0xFF: the first pair only (pyvisonic, without partitions);
 * anything else: none.
 */
export function decodeEvents(data) {
  if (data.length < 10) return [];
  const count = data[0];
  const pairs = count === 0xff ? 1 : count >= 1 && count <= 4 ? count : 0;
  const events = [];
  for (let i = 0; i < pairs; i += 1) events.push({ zone: data[2 + 2 * i], type: data[3 + 2 * i] });
  return events;
}
