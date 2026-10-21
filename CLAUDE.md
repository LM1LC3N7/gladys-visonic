# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "disarm"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/handlers.js                   the SDK handlers, shared with the tests
src/app.js                        VisonicApp: lifecycle, model, devices, states, events, commands
src/visonic/frame.js              frames: checksum, lengths, linear reader, masks (pyvisonic)
src/visonic/protocol.js           commands, user code field, A5 / A7 decoding (pyvisonic)
src/visonic/client.js             one TCP connection: acknowledges, status requests, commands
src/devices.js                    model -> Gladys devices and states (pure)
src/publisher.js                  states and scene events under the Gladys rate limits
src/store.js                      /data: the stop after a refused user code, connection attempts
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js, src/i18n.js     keys, timings, limits; French and English texts
scripts/cover.mjs                 cover.png (800x534), plain Node
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, the SDK's fake Gladys + test/helpers/fakeVisonic.js
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Safety rules of this integration (see TODO.md "Decisions"): arming is always
allowed and protective (never behind a disarm, never lowering the
protection); disarming stays off by default and its option is read again
right before the write; commands are push buttons, never switches; a disarm
decides on the state read from the panel just before it; a command is done
only when the state read back shows it; a command that may have left is
never reported "not sent"; a refused user code is never sent again by itself
(only a new code or the "Allow a new try of the code" action lift the stop);
the user code is never logged; Standard mode only (no download code, no
Powerlink), TCP only; the panel is never read faster than its interval
(test button, Discovery, Gladys reconnections send nothing).

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
