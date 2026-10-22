// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. They also keep
// the texts clean (no mojibake, no BOM, no control byte) and honest (never
// tested, unofficial, a secret field is not "encrypted").
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ALARM_KINDS } from '../src/app.js';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, ARM_MODES, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const values = (field) => field.options.map((o) => o.value);
const TEXT_FILES = [
  'gladys-assistant-integration.json',
  'docs/fr.md',
  'docs/en.md',
  'README.md',
  'CHANGELOG.md',
  'TODO.md',
  'CLAUDE.md',
  'THIRD_PARTY_NOTICES.md',
];

/** Every source and text file of the repository (no dependency, no binary). */
const SOURCE_FILES = [
  ...TEXT_FILES,
  'index.js',
  'package.json',
  'Dockerfile',
  'SECURITY.md',
  'LICENSE',
  ...readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => `src/${f.replaceAll('\\', '/')}`),
  ...readdirSync(new URL('../test/', import.meta.url), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => `test/${f.replaceAll('\\', '/')}`),
  'scripts/cover.mjs',
];

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.gladys_version, '>=5.1.0', 'scene triggers and actions need Gladys 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-visonic:${manifest.version}`);
  // Set by hand to 0.1.0 once, then by the Release workflow only.
  assert.match(manifest.version, /^0\.\d+\.\d+$/);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Visonic|sans\s+lien\s+avec\s+Visonic/i);
    assert.match(docs, /never\s+(been\s+)?tested|jamais\s+(été\s+)?testée?/i, `docs/${lang}.md`);
  }
});

test('no double-encoded UTF-8 (mojibake) and no BOM in the texts', () => {
  // U+00C3 U+00A9 for "Ã©", U+00C2 U+00AB for "Â«", U+00E2 U+20AC for "â€":
  // UTF-8 read as Windows-1252 and written again. Built from code points so
  // this file never holds one.
  const c = (code) => String.fromCharCode(code);
  const mojibake = new RegExp(
    `[${c(0xc2)}${c(0xc3)}][${c(0x80)}-${c(0xbf)}${c(0x20ac)}${c(0x201a)}-${c(0x2122)}]|${c(0xe2)}${c(0x20ac)}`,
  );
  assert.match(`caf${c(0xc3)}${c(0xa9)}`, mojibake, 'the guard catches a double encoding');
  assert.match(`${c(0xe2)}${c(0x20ac)}${c(0x201d)}`, mojibake, 'and the dash family');
  for (const path of TEXT_FILES) {
    const text = read(path);
    assert.doesNotMatch(text, mojibake, path);
    assert.notEqual(text.charCodeAt(0), 0xfeff, `${path} starts with a BOM`);
  }
});

test('no control byte in any file (tabs, line feeds and carriage returns only)', () => {
  for (const path of SOURCE_FILES) {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    const bad = bytes.findIndex(
      (b) => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f,
    );
    assert.equal(bad, -1, `${path}: control byte at ${bad}`);
  }
});

test('a secret field is never said to be encrypted', () => {
  for (const path of TEXT_FILES) {
    // "chiffres" (digits) is fine, "chiffré" (encrypted) is not.
    assert.doesNotMatch(read(path), /chiffré|chiffrement|\bencrypt/i, path);
  }
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(
    secrets.map((f) => f.key),
    ['user_code'],
  );
  for (const field of secrets) {
    assert.match(field.description.en, /Kept by Gladys in its database, never shown again/);
    assert.match(field.description.fr, /par Gladys dans sa base, jamais réaffiché/);
    assert.match(field.description.en, /clear text/);
    assert.match(field.description.fr, /en clair/);
  }
});

test('the licence names nobody; the reference is credited in full, as published', () => {
  const licence = read('LICENSE');
  assert.match(licence, /Apache License/);
  assert.match(licence, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.doesNotMatch(licence, /Copyright (?:\(c\) )?\d{4}/i);
  const notices = read('THIRD_PARTY_NOTICES.md');
  // pyvisonic's LICENSE holds the copyright line of a packaging template:
  // reproduced as it is, the authors credited beside it.
  assert.match(
    notices,
    /pyvisonic[\s\S]*4\.0\.8[\s\S]*MIT License[\s\S]*Copyright \(c\) 2018 The Python Packaging Authority[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/,
  );
  assert.match(notices, /davesmeghead/);
  assert.match(read('Dockerfile'), /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.equal(fields.allow_disarm.default, false, 'disarming from Gladys is opt-in');
  assert.equal(fields.allow_arm, undefined, 'arming is always allowed (it protects)');
  assert.equal(fields.user_code.type, 'secret', 'the code is never sent back to the browser');
  assert.equal(fields.host.required, true);
  assert.equal(fields.port.required, true);
  assert.equal(fields.download_code, undefined, 'no download code: Standard mode only');
  assert.match(fields.safety.description.en, /false alarm.*monitoring company/);
  assert.match(fields.safety.description.fr, /fausse alarme.*télésurveillance/);
  assert.match(fields.intro.description.en, /serial or USB link is not supported/);
  for (const lang of ['en', 'fr']) {
    const docs = read(`docs/${lang}.md`);
    assert.match(docs, lang === 'en' ? /monitoring company/ : /télésurveillance/);
    assert.match(
      docs,
      lang === 'en' ? /Allow a new try of the code/ : /Autoriser un nouvel essai du code/,
    );
    assert.match(docs, /pyvisonic/);
  }
  assert.deepEqual(values(fields.language), LANGUAGES);
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required ?? section.default ?? section.placeholder, undefined);
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang} too long`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const arm = manifest.scene_actions.find((a) => a.key === 'arm');
  assert.deepEqual(values(arm.fields.find((f) => f.key === 'mode')), ARM_MODES);
});

test('the trigger fields and variables are what the events carry', () => {
  const expected = {
    alarm_triggered: ['kind', 'zone', 'fire'],
    armed: ['mode', 'mode', 'by_gladys'],
    disarmed: ['by_gladys'],
  };
  for (const trigger of manifest.scene_triggers) {
    const declared = [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
    assert.deepEqual(declared, expected[trigger.key], trigger.key);
    for (const key of new Set(declared)) {
      assert.match(app, new RegExp(`\\b${key}[:,\\s}]`), `${trigger.key}: ${key} is never sent`);
    }
  }
  const modes = manifest.scene_triggers.find((t) => t.key === 'armed').fields[0];
  assert.deepEqual(values(modes), ARM_MODES);
  const kinds = manifest.scene_triggers.find((t) => t.key === 'alarm_triggered').description.en;
  for (const kind of ALARM_KINDS.filter((k) => k !== 'intrusion'))
    assert.match(kinds, new RegExp(kind));
});
