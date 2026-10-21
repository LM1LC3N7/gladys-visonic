// -----------------------------------------------------------------------------
// The panel model -> Gladys devices and states (pure).
//
// Ids that do not depend on the adapter address (a new DHCP lease keeps the
// devices) and that the panel itself numbers; one panel per integration:
// - `ext:<selector>:panel:visonic`: link, state (read-only text), armed,
//   ready, trouble, panel tamper, alarm in progress, fire alarm, and the
//   arm away / arm stay / disarm BUTTONS;
// - `ext:<selector>:zone:<n>`: one state feature keyed by the zone kind
//   (`:opening`, `:motion`, `:smoke` or `:leak`), tamper, low battery,
//   alarm, bypassed.
//
// No command is a switch or a binary: a "turn everything off" (voice
// assistants, HomeKit, scenes on switches) must never reach the alarm. The
// states are read-only, the commands are push buttons.
//
// A device published again never loses a feature the user created (Gladys
// would mark it changed, and "Update" would drop its history): the features
// of the created device that the configuration no longer gives are kept.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { OPENING_SENSOR_STATE } from './constants.js';
import { DEVICE_NAMES, FEATURE_NAMES, MODE_NAMES, word } from './i18n.js';

const binary = (category, type) => ({
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

/** Feature definitions by key (the last part of their external id). Keys are forever. */
export const PANEL_FEATURES = {
  online: binary(C.INPUT, T.INPUT.BINARY),
  mode: {
    category: C.TEXT,
    type: T.TEXT.TEXT,
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    // A text history is not charted; the armed / disarmed events are the history.
    keep_history: false,
  },
  armed: binary(C.INPUT, T.INPUT.BINARY),
  ready: binary(C.INPUT, T.INPUT.BINARY),
  trouble: binary(C.INPUT, T.INPUT.BINARY),
  'panel-tamper': binary(C.TAMPER, T.TAMPER.BINARY),
  alarm: binary(C.SIREN, T.SIREN.BINARY),
  'fire-alarm': binary(C.SIREN, T.SIREN.BINARY),
  'arm-away': button,
  'arm-stay': button,
  disarm: button,
};

/** The state feature of a zone, by kind (the kind is also its feature key). */
export const ZONE_STATE = {
  opening: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
  motion: binary(C.MOTION_SENSOR, T.SENSOR.BINARY),
  smoke: binary(C.SMOKE_SENSOR, T.SENSOR.BINARY),
  leak: binary(C.LEAK_SENSOR, T.SENSOR.BINARY),
};

export const ZONE_FEATURES = {
  tamper: binary(C.TAMPER, T.TAMPER.BINARY),
  battery: binary(C.BATTERY_LOW, T.BATTERY_LOW.BINARY),
  alarm: binary(C.SIREN, T.SIREN.BINARY),
  bypass: binary(C.INPUT, T.INPUT.BINARY),
};

const ZONE_FEATURE_NAMES = {
  tamper: 'tamper',
  battery: 'battery',
  alarm: 'zone-alarm',
  bypass: 'bypass',
};

export const ids = {
  panel: (gladys) => gladys.externalIds('panel', 'visonic'),
  zone: (gladys, n) => gladys.externalIds('zone', String(n)),
};

/** `ext:sel:panel:visonic:arm-away` -> { kind: 'panel', key: 'arm-away' }. */
export function parseFeatureId(externalId) {
  const match = /:(panel|zone):([a-z0-9]+):([a-z-]+)$/.exec(String(externalId ?? ''));
  if (!match) return undefined;
  return {
    kind: match[1],
    number: match[1] === 'panel' ? undefined : Number(match[2]),
    key: match[3],
  };
}

const feature = (deviceIds, key, name, definition) => ({
  name,
  external_id: deviceIds.feature(key),
  ...definition,
});

/** The kind of a zone: the configured one, else an opening. */
export const zoneKind = (config, n) => config.zones.get(n) ?? 'opening';

/** What a discovered feature declares (a created one also has ids, values, dates). */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'unit',
];

/** Adds to each device the features of its created twin it no longer has. */
export function keepCreatedFeatures(devices, created = []) {
  const byId = new Map((created ?? []).map((device) => [device.external_id, device]));
  return devices.map((device) => {
    const twin = byId.get(device.external_id);
    if (!twin?.features?.length) return device;
    const have = new Set(device.features.map((f) => f.external_id));
    const kept = twin.features
      .filter((f) => f?.external_id && !have.has(f.external_id))
      .map((f) =>
        Object.fromEntries(
          FEATURE_FIELDS.filter((key) => f[key] !== undefined && f[key] !== null).map((key) => [
            key,
            f[key],
          ]),
        ),
      );
    return kept.length === 0 ? device : { ...device, features: [...device.features, ...kept] };
  });
}

export function buildDevices(gladys, config, created = gladys.devices) {
  const { language } = config;
  const panelIds = ids.panel(gladys);
  const devices = [
    {
      name: word(DEVICE_NAMES.panel, language),
      external_id: panelIds.device,
      should_poll: false,
      params: [],
      features: Object.entries(PANEL_FEATURES).map(([key, definition]) =>
        feature(panelIds, key, word(FEATURE_NAMES[key], language), definition),
      ),
    },
  ];
  for (const n of config.zones.keys()) {
    const zoneIds = ids.zone(gladys, n);
    const kind = zoneKind(config, n);
    devices.push({
      name: word(DEVICE_NAMES.zone, language)(n),
      external_id: zoneIds.device,
      should_poll: false,
      params: [
        { name: 'zone', value: String(n) },
        { name: 'kind', value: kind },
      ],
      features: [
        feature(zoneIds, kind, word(FEATURE_NAMES.kind[kind], language), ZONE_STATE[kind]),
        ...Object.entries(ZONE_FEATURES).map(([key, definition]) =>
          feature(zoneIds, key, word(FEATURE_NAMES[ZONE_FEATURE_NAMES[key]], language), definition),
        ),
      ],
    });
  }
  return keepCreatedFeatures(devices, created);
}

const flag = (value) => (value === undefined ? undefined : value ? 1 : 0);

/**
 * Every known state: `[{ device_feature_external_id, state | text }]`.
 * Offline, only the link: the rest is the last state seen, not the panel's.
 */
export function buildStates(gladys, config, model, { online }) {
  const states = [];
  const push = (deviceIds, key, value) => {
    if (value === undefined) return;
    states.push({
      device_feature_external_id: deviceIds.feature(key),
      ...(typeof value === 'string' ? { text: value } : { state: value }),
    });
  };
  const panel = ids.panel(gladys);
  push(panel, 'online', online ? 1 : 0);
  if (!online || !model.system) return states;
  const { system, alarm } = model;
  push(panel, 'mode', word(MODE_NAMES[system.mode] ?? MODE_NAMES.unknown, config.language));
  push(panel, 'armed', flag(system.armed && !system.arming));
  push(panel, 'ready', flag(system.ready));
  push(panel, 'trouble', flag(system.trouble));
  push(panel, 'panel-tamper', flag(alarm.tamper));
  push(panel, 'alarm', flag(alarm.intruder || alarm.kinds.size > 0));
  push(panel, 'fire-alarm', flag(alarm.kinds.has('fire')));
  for (const n of config.zones.keys()) {
    const zoneIds = ids.zone(gladys, n);
    const kind = zoneKind(config, n);
    const zone = model.zones.get(n) ?? {};
    const active = kind === 'motion' ? zone.motion : zone.open;
    push(
      zoneIds,
      kind,
      active === undefined || kind !== 'opening'
        ? flag(active)
        : active
          ? OPENING_SENSOR_STATE.OPEN
          : OPENING_SENSOR_STATE.CLOSE,
    );
    push(zoneIds, 'tamper', flag(zone.tamper));
    push(zoneIds, 'battery', flag(zone.battery));
    push(zoneIds, 'alarm', flag(zone.trip));
    push(zoneIds, 'bypass', flag(zone.bypass));
  }
  return states;
}
