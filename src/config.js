// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { LIMITS, ZONE_KINDS } from './constants.js';
import { isUserCode } from './visonic/protocol.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  allow_disarm: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const integer = (value, min, max) => {
  const text = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const number = Number(text);
  return number >= min && number <= max ? number : undefined;
};

/** `192.168.1.40`, `adapter.lan:10628`, `tcp://192.168.1.40` -> { host, port? }. */
export function parseHost(raw) {
  let text = String(raw ?? '').trim();
  text = text.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const match = /^(\[[0-9a-f:.]+\]|[^:\s]+)(?::(\d{1,5}))?$/i.exec(text);
  if (!match || text.length > 253) return { host: '' };
  const port = match[2] ? Number(match[2]) : undefined;
  return {
    host: match[1].replace(/^\[|\]$/g, ''),
    port: port >= 1 && port <= 65535 ? port : undefined,
  };
}

/** The user code: exactly 4 digits, '' when absent or malformed. */
export const normalizeCode = (raw) => {
  const text = String(raw ?? '').trim();
  return isUserCode(text) ? text : '';
};

/**
 * `1-4, 7, 9:motion` -> Map(zone -> kind or undefined). Entries are
 * separated by commas, semicolons or new lines; `=` works like `:`. Wrong
 * entries are reported, not fatal.
 */
export function parseZones(raw, max = LIMITS.maxZones) {
  const zones = new Map();
  const errors = [];
  // Bounded: a configuration field is short; anything longer is cut.
  for (const entry of String(raw ?? '')
    .slice(0, 2000)
    .split(/[,;\n]+/)) {
    const text = entry.trim();
    if (text === '') continue;
    const match = /^(\d{1,3})(?:\s*-\s*(\d{1,3}))?(?:\s*[:=]\s*([a-z]+))?$/i.exec(text);
    const kind = match?.[3]?.toLowerCase();
    const from = Number(match?.[1]);
    const to = match?.[2] ? Number(match[2]) : from;
    if (
      !match ||
      from < 1 ||
      to > max ||
      to < from ||
      (kind !== undefined && !ZONE_KINDS.includes(kind))
    ) {
      errors.push(text.slice(0, 40));
      continue;
    }
    for (let n = from; n <= to; n += 1) zones.set(n, kind ?? zones.get(n));
  }
  return { zones, errors };
}

export function normalizeConfig(raw = {}) {
  const { host, port: hostPort } = parseHost(raw?.host);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const typedCode = String(raw?.user_code ?? '').trim();
  const zones = parseZones(raw?.zones);
  return {
    host,
    // A port typed with the address wins over the port field.
    port: hostPort ?? integer(raw?.port, 1, 65535),
    code: normalizeCode(typedCode),
    codeInvalid: typedCode !== '' && normalizeCode(typedCode) === '',
    zones: new Map([...zones.zones.entries()].sort(([a], [b]) => a - b)),
    zoneErrors: zones.errors,
    allowDisarm: bool(raw?.allow_disarm, DEFAULTS.allow_disarm),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}

/** What the session depends on: a change reconnects. Neither the code nor the zones are in it. */
export const sessionKey = (config) => JSON.stringify([config.host, config.port]);
