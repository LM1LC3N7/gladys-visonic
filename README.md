# Gladys external integration — JavaScript template

Official starter template for building an **external integration** for
[Gladys Assistant](https://gladysassistant.com) with the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

> Fork it, add the GitHub topic `gladys-assistant-integration`, push a
> multi-arch image, bump the version — that's publishing. No account, no review.

## What this template demonstrates

This is **not** a 40-line hello-world: it deliberately shows several **device
types** so you can copy the one closest to your hardware. Everything lives in
the [`src/devices/`](./src/devices) folder (one file per device type), and every
place where you would talk to your real hardware / cloud API is marked with a
`DO THE WORK` comment and a `logger` call.

| Device                 | Type illustrated                                                         | SDK hooks used                                                      |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Weather station        | Read-only sensors (temperature + humidity), **real data** via Open-Meteo | `onPoll`, `publishStates`, `onAction`                               |
| Living room switch     | Binary actuator (ON/OFF)                                                 | `onSetValue`, `publishState`                                        |
| Living room light      | Dimmable light (on/off **+** brightness), `identify` action target       | `onSetValue` per feature, `identify`                                |
| Office plug            | Mixed: actuator **+** power metering, transport badge **+ degraded**     | `onSetValue`, `onPoll`, `publishChangedStates`, `publishTransports` |
| Entrance motion sensor | Push / event-driven sensor **+** scene trigger                           | `startPush`, `publishState`, `publishSceneEvent`                    |
| Entrance camera        | Camera images: periodic snapshot **+** on-demand fresh capture           | `publishCameraImage`, `onGetImage`                                  |

On top of the devices, it demonstrates the three **capability** surfaces of
SDK v0.14 — scene triggers, scene actions and dashboard widgets, **Gladys
5.1+** — built on the same demo devices (see
[below](#scene-triggers-scene-actions-and-dashboard-widgets)):

| Capability                     | Manifest key      | Code                                                           | SDK hooks used                                          |
| ------------------------------ | ----------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Scene trigger: motion detected | `motion_detected` | [`src/devices/motionSensor.js`](./src/devices/motionSensor.js) | `publishSceneEvent`                                     |
| Scene action: identify device  | `identify_device` | [`src/scenes.js`](./src/scenes.js)                             | `onSceneAction`                                         |
| Dashboard widget: demo status  | `demo_status`     | [`src/widgets.js`](./src/widgets.js)                           | `onWidgetGet`, `onWidgetAction`, `requestWidgetRefresh` |

The wiring (connection, auth, reconnection, dispatch) is in
[`index.js`](./index.js) — you rarely need to touch it.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no device logic)
├─ src/
│  ├─ devices/                       # ← one file per device type (edit these)
│  │  ├─ index.js                    #   registry: list your devices here
│  │  ├─ weatherStation.js           #   read-only sensors (poll)
│  │  ├─ switchDevice.js             #   binary actuator
│  │  ├─ light.js                    #   dimmable light (on/off + brightness)
│  │  ├─ plug.js                     #   actuator + power metering + transport badge
│  │  ├─ motionSensor.js             #   push / event-driven sensor + scene trigger
│  │  └─ camera.js                   #   camera images (push + pull)
│  ├─ scenes.js                      # scene actions (Gladys 5.1+)
│  ├─ widgets.js                     # dashboard widget (Gladys 5.1+)
│  ├─ weather.js                     # example real "driver" (Open-Meteo)
│  └─ config.js                      # config defaults + normalization
├─ docs/
│  ├─ en.md                          # user documentation (re-hosted by Gladys,
│  └─ fr.md                          #   linked from the Configuration screen)
├─ test/                             # unit tests (`node --test`)
├─ gladys-assistant-integration.json # manifest (name, config schema, image…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24), Docker build
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build
├─ .github/workflows/build.yml       # multi-arch build (git tag or called by release)
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/release.mjs       # release helpers (manifest bump, changelog)
├─ .github/dependabot.yml            # weekly npm / monthly GitHub Actions updates
└─ cover.png                         # catalog cover, 800×534 px, ≤150 KB
```

To add a device type, create a new file in `src/devices/` following the same
shape as the existing ones, then register it in `src/devices/index.js`. Business
logic (the device modules) and utilities (`weather.js`, `config.js`) are kept
separate so the parts you edit stay small.

The plumbing you would otherwise copy into every integration comes straight
from the SDK (v0.15.0+):

- `logger` / `createLogger({ name })` — leveled console logger (`LOG_LEVEL`
  env var), with named/child loggers per module. Since SDK v0.4 the SDK also
  logs its own connection lifecycle (under the `gladys-sdk` name), so
  connectivity problems show up in `docker logs` without extra code;
- `DEVICE_FEATURE_CATEGORIES`, `DEVICE_FEATURE_TYPES`, `DEVICE_FEATURE_UNITS`
  — the standard Gladys categories / types / units, no manual string copying.
  The catalog grows with the SDK, so bumping the dependency is how you get the
  newest ones: `battery-storage`, `doorbell` and `water-valve` categories, the
  climate `fan-speed` / `swing-horizontal` / `swing-vertical` features and the
  `cubic-meter-per-hour` unit (SDK v0.10), then `charging-station` and
  `water-heater` categories plus the thermostat `mode` / `operating-state`
  features (SDK v0.11), then the `grid-sensor` / `home-output-sensor` /
  `maintenance` categories, the `no2` / `o3` / `so2` gas-concentration
  sensors, the camera PTZ features (`move` / `preset` / absolute positions),
  the solar `production` `power` feature and the dynamic `text` `select` type
  whose per-device choices live in `supported_options` (SDK v0.12), then the
  camera `enabled` feature (a Gladys-side privacy gate: `0` makes Gladys stop
  polling, streaming and serving the camera image without deleting the
  camera), the siren `alarm-mode` / `alarm-state` features and the battery
  `charging` binary sensor (SDK v0.13), then the `grid-carbon-sensor`
  category (`carbon-intensity` in the new `gram-co2eq-per-kilowatt-hour`
  unit, plus the `carbon-free-percentage` / `renewable-percentage` shares of
  the grid mix — the electricity of a zone, not what a device imports or
  exports, which stays in `grid-sensor`), the temperature `probe` type (an
  external probe wired to the device, kept out of the room average), the
  smoke-sensor `contamination-state` / `muted` / `temporary-mute` features
  and the single-phase Linky `smaxn1` / `sinsts1` / `imax1` fields (SDK
  v0.14), then the thermostat `preset` feature — which temperature to aim
  for, next to the `mode` that says what the machine does (SDK v0.15). A recent
  category only renders on a Gladys that knows it, so keep the manifest
  `gladys_version` range in sync with what you publish;
- `gladys.externalIds(type, platformId)` — builds the unique, stable device
  and feature external ids;
- `should_poll` + `DEVICE_POLL_FREQUENCIES` (SDK v0.15) — Gladys calls
  `onPoll` only for a device published with `should_poll: true` and a
  `poll_frequency` **in milliseconds** among `DEVICE_POLL_FREQUENCIES` (1 s
  to 1 min); any other value makes Gladys refuse the whole discovery list
  with a `400`. Both are read once, when the user creates the device, and a
  minute is the slowest pace: the weather station and the plug declare
  `EVERY_MINUTES`, and `createPoller` in
  [`src/devices/index.js`](./src/devices/index.js) applies the slower
  refresh interval of the config by skipping the polls in between;
- `gladys.publishChangedStates(states, { heartbeat })` (SDK v0.15) — the
  `publishStates` format, minus the values that did not change since the
  last call: the host API accepts 300 states per minute, sized for changes,
  not snapshots. The demo plug publishes its power reading with it, so an
  idle plug sends its 0 W once, then every 30 minutes;
- `gladys.handleShutdown(cleanup)` — graceful SIGTERM/SIGINT handling;
- `gladys.setConnectionStatus(connected, message?)` — application-level
  connection status shown in the Configuration screen (the template reports it
  after every (re)initialization);
- `gladys.onAction(key, cb)` — handler of a manifest `actions` button: the
  template declares a `test_weather` action (manifest `actions` field) and the
  weather station blueprint implements it, returning the multi-language
  message displayed under the button;
- `gladys.publishCameraImage(externalId, image)` / `gladys.onGetImage(cb)`
  (SDK v0.5) — the camera image channel: push a periodic snapshot and answer
  on-demand capture requests with an `image/jpg;base64,...` string (≤ 150 KB,
  max 12 images/minute per device). Dedicated channel: images never go through
  the states history. See [`src/devices/camera.js`](./src/devices/camera.js);
- `gladys.publishTransports(entries)` + `DEVICE_TRANSPORTS` (SDK v0.5) — the
  per-device cloud/local transport badge for dual-channel devices. The
  manifest declares `"transports": ["local", "cloud"]`, so the Configuration
  screen shows a standard "Prefer the local connection" toggle whose value
  arrives as the reserved, read-only config key `GLADYS_PREFER_LOCAL`
  (boolean, default `true`). The demo plug applies the preference and reports
  its effective transport. Since SDK v0.7 an entry can also flag a
  **degraded** state (`{ degraded: true, message }`) — "it works, but not in
  the nominal mode": the demo plug uses it when local is preferred but the
  LAN session is refused, so the cloud fallback shows an orange dot with the
  reason instead of a silently normal badge. See
  [`src/devices/plug.js`](./src/devices/plug.js);
- dynamic device selects (SDK v0.7) — a manifest `select` field can replace
  its static `options` with `"source": "devices"`: the Configuration screen
  fills it with the integration's own created devices and the handler
  receives the chosen `external_id`. The template's `identify` action uses it
  to make the chosen device signal itself — the answer to "act on THIS
  device" without asking the user to copy an identifier;
- `section` config blocks + the Documentation link (SDK v0.8) — purely
  presentational intro blocks in the manifest `config_schema` (title,
  plain-text description, https links) for the onboarding guidance a compact
  form cannot carry; they store no value. For the long step-by-step, the
  Configuration screen shows a permanent **Documentation** link to the repo's
  [`docs/en.md`](./docs/en.md) / [`docs/fr.md`](./docs/fr.md), re-hosted by
  Gladys.

The SDK offers more for integrations that need it — OAuth2 cloud flows
(`onOAuthAuthorizeUrl` / `onOAuthCallback` + an `oauth2` config field, or the
`account_link` variant — SDK v0.12 — for providers that never redirect back:
QR sign-in approved in the vendor app, `redirectUri` undefined, no callback,
the integration polls the provider and reports through
`setConnectionStatus(true)`), sub-containers (`getContainers`, `startContainer`… + the manifest `containers`
field, whose published ports now come back as
`{ container_port, protocol, host_port, label, name, browsable }` — SDK v0.11,
`host_port` being the one Gladys allocated, `null` until it does, and `name`
what makes it referenceable in a manifest section text through the
`{{gladys_host}}` / `{{port:<name>}}` placeholders the frontend substitutes at
render time), mediated network discovery (`scanNetwork` + the manifest
`network_discovery` field, for UDP-broadcast / mDNS / SSDP scans from the
core — including the active query/response variant `udp-active-broadcast`,
SDK v0.7, where the integration forges the discovery request and the core
broadcasts it; since SDK v0.13 the results are precisely typed: an `mdns`
scan browses every declared entry and merges the results, and each `ssdp`
responder comes back as `{ source_ip, source_mac?, source_port, headers }`,
`source_mac` being a best-effort ARP-table lookup by the core — when present
it saves asking the user for a MAC before `wakeOnLan`), communication channels (manifest `type: "communication"`:
bidirectional Telegram-like bots linked by code — SDK v0.6,
`publishMessage` / `onSendMessage` / `linkContact` — and, since SDK v0.9,
send-only notification channels — `messaging: { receive: false }` plus a
manifest `contact_schema` describing the per-user credentials that
`onSendMessage(contact, message)` receives), and incoming webhooks relayed
by Gladys Plus (SDK v0.9: manifest `webhooks` field +
`getWebhooks` / `onWebhook` / `onWebhookUpdated`, for cloud services that
push their events Netatmo-style — the demo weather API only supports
polling, so the template does not declare any), Wake-on-LAN (SDK v0.12:
`wakeOnLan(mac, options?)` + the manifest `network_wake` field — the core,
which sits on the host network the bridge container cannot broadcast to,
builds and emits the standard magic packet itself, rate-limited to 1 wake
per 2 s per integration), and weather providers
(SDK v0.11: manifest `type: "weather"`, `onWeatherGet` answering with the
pivot weather format in the unit system the user asked for, plus the optional
`onWeatherGetImage` for a vigilance map or a rain radar and
`requestWeatherRefresh()` to nudge the core into re-pulling instead of waiting
for its 30-minute check. SDK v0.13 extends the pivot conditions enum with
`freezing-rain`, `freezing-fog`, `snow-thunderstorm`, `sandstorm`, `tornado`
and `hurricane` — keep sending the broader condition when your provider
cannot tell them apart. A provider feeds the dashboard widget and the chat
assistant, not devices, so it is a different integration type than this
template's `type: "device"`, even though the demo weather station here reads
the same kind of API). SDK v0.14 adds three more surfaces: the house
location (`getHouses()` → `[{ id, name, selector, latitude, longitude }]`,
gated by a manifest `"location": true` shown on the install screen — for an
integration that owns its own geo-dependent logic, water restrictions or
pollen, and polls a third party itself instead of re-asking the coordinates
in its config; the demo weather station keeps its own `latitude` /
`longitude` fields on purpose, they are the "coordinates to observe", not
the home), scene triggers and actions, and dashboard widgets — the last two
are demonstrated by this template, see the next section. SDK v0.15 adds
calendar providers (manifest `type: "calendar"`: the integration syncs the
calendars of the users who enabled it, the core stores them), energy
contracts (manifest `energy_contracts`: tariff templates offered in the
Gladys contract wizard, the calendars they need, and
`publishEnergyConsumption` for suppliers whose readings arrive after the
fact), `"source": "houses"` selects (the user picks one of the Gladys houses,
the handler receives its selector), forms on widget buttons (the values the
user typed reach `onWidgetAction` as `values`, next to `settings`) and
`parseMdnsTxt(txt)`, which turns the raw TXT entries of an `mdns` scan into
an object. See the
[SDK README](https://github.com/GladysAssistant/integration-sdk-js) for the
other patterns; this template stays focused on devices and the capabilities
built on them.

## Scene triggers, scene actions and dashboard widgets

Since SDK v0.14, any integration — `device` included — can extend the scene
editor and the dashboard on top of its primary contract, through three
manifest capability fields. The template declares one of each, built on its
demo devices:

- **Scene trigger** `motion_detected` (manifest `scene_triggers`) — every
  detection of the demo motion sensor fires
  `gladys.publishSceneEvent('motion_detected', { device, target })`. The
  scene author filters on the sensor (a `"source": "devices"` select) and on
  what moved (a `multi_select`), then reads `{{triggerEvent.data.target}}`
  in the following actions. The state (0/1) stays a device feature published
  with `publishState`: the event says "this happened, with these details".
  One event per transition, flat `data` (≤ 30 primitive keys), only the keys
  declared in `fields` / `variables` kept, 300 events/minute. No handler to
  register: see [`src/devices/motionSensor.js`](./src/devices/motionSensor.js).
- **Scene action** `identify_device` (manifest `scene_actions`) — the
  `identify` operation of the Configuration screen, reachable from a scene.
  `gladys.onSceneAction(key, cb)` receives the RESOLVED `fields` and returns
  the declared scalar `outputs` (`{ signalled: true }`). A device that cannot
  signal itself is an output, not a failure: a scene action is never a
  condition, the scene author gates on the output. See
  [`src/scenes.js`](./src/scenes.js).
- **Dashboard widget** `demo_status` (manifest `widgets`, up to 5) — two
  **live** `value` tiles bound to device features (`device_feature`: they
  follow the published states, nothing to refresh), a `status` list computed
  by the integration (plug connection, observed location) and a `button`
  whose `action` reaches `gladys.onWidgetAction` (with the `params` the
  content declared, never user input) and answers a toast. The content is
  declarative — `text`, `value`, `gauge`, `status`, `chart`, `card-list`,
  `image`, `button`, colors from `WIDGET_COLORS` — and the core renders it
  with its own theme, dark mode and translations, no HTML. The core caches it
  until its `ttl_seconds`; `index.js` calls `gladys.requestWidgetRefresh(key)`
  after every (re)connection and config update, which change the computed
  rows. See
  [`src/widgets.js`](./src/widgets.js).

> **Requires Gladys ≥ 5.1.0.** Older cores reject unknown manifest fields, so
> declaring `scene_triggers`, `scene_actions` or `widgets` requires a
> `gladys_version` range starting at **`>=5.1.0`** — the store validator
> rejects anything lower, and `test/manifest.test.js` catches it before you
> tag. That is why the template declares `>=5.1.0`. To support older
> releases, remove the three fields from the manifest along with the code
> serving them (`src/scenes.js`, `src/widgets.js`, their wiring in
> `index.js` and the `publishSceneEvent` call of the motion sensor).

The tests show how to keep the declarations and the code in sync:

- [`test/manifest.test.js`](./test/manifest.test.js) — every `scene_actions`
  key has an `onSceneAction` handler, every `widgets` key an `onWidgetGet`
  handler, every trigger the devices fire is declared in `scene_triggers`
  (and the other way round), and `gladys_version` is `>=5.1.0`;
- [`test/scenes.test.js`](./test/scenes.test.js) — one event per detection,
  event `data` and action `outputs` limited to their declared keys;
- [`test/widgets.test.js`](./test/widgets.test.js) —
  `assert.deepEqual(validateWidgetContent(content), [])` (exported by the
  SDK: `[]` means rendered exactly as sent, nothing dropped or truncated),
  live tiles bound to published features, every button action handled;
- the fake Gladys of the SDK (see [Quality checks](#quality-checks)) records
  the `publishSceneEvent` and `requestWidgetRefresh` calls.

In development, `DEBUG=gladys-integration-sdk` makes the SDK validate every
widget content (and image) the handlers resolve and log the violations. A
widget-only or scene-only integration declares the manifest
`type: "provider"` instead: no device surface, a configuration-only page.

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="demo-devices-template" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container. The SDK reads them
automatically.

## Quality checks

The template ships with the tooling every integration should keep. The same
three checks run automatically on every push and pull request, on Node 22 and
Node 24, along with a build of the Docker image (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
npm run format:check   # Prettier: is everything formatted?
npm run format         # Prettier: format everything in place
npm run lint           # ESLint: catch real mistakes (unused vars, dead code…)
npm test               # Unit tests, via the built-in `node --test` runner
```

Tests live in [`test/`](test/) and use Node's native test runner — no extra
test framework to install. Add a `*.test.js` file next to the ones already
there and it is picked up automatically.

The tests pass the device modules a fake Gladys from the SDK,
`createFakeGladys()` from `@gladysassistant/integration-sdk/testing` (SDK
v0.15): a real `GladysIntegration` whose transport is an in-memory Gladys.
It records what Gladys would receive (`gladys.fake.states`,
`discoveredDevices`, `sceneEvents`, `widgetRefreshes`…) and refuses the
payloads the host API refuses, with the same `400`: an invalid category,
unit or `poll_frequency` fails `npm test`, not the user's discovery. It
also plays Gladys' side of the WebSocket (`gladys.fake.poll(device)`,
`setValue`, `action`…) — see the
[SDK README](https://github.com/GladysAssistant/integration-sdk-js#testing-your-integration).

[Dependabot](.github/dependabot.yml) opens a pull request every week for the
npm dependencies — the SDK first of all, which is how new device categories
and features reach you — and every month for the GitHub Actions; the CI checks
them like any other change.

## Validate before publishing

Before you tag a release, you can check that your integration passes the store
validation **locally**, without waiting for the hourly indexer. Run the store's
validator against your integration directory:

```bash
npx github:GladysAssistant/integration-store .
```

It runs the exact same checks as the store indexer — manifest JSON & schema,
Docker image availability (main and sub-containers), cover image (format,
dimensions, size) and the code rules — and reports **every** problem at once so
you can fix them in a single pass. It exits `0` when the integration is valid,
`1` otherwise. A few things can only be confirmed once the repository is public
(public repo, the `gladys-assistant-integration` topic, and the manifest sitting
at the root of the default branch), and the tool tells you which ones. See the
[integration store](https://github.com/GladysAssistant/integration-store) for
details.

The validator is not part of the CI: it also checks that the manifest
`docker_image` exists on its registry, which is only true once the version is
released. [`test/manifest.test.js`](test/manifest.test.js) catches, on every
`npm test`, the store rules that are easiest to miss:

- the catalog `description` holds **10 to 100 characters** per language;
- every text is a **multi-language object** (`{ "en": "…", "fr": "…" }`):
  `label` and `description`, but also a field `placeholder` — a plain string
  rejects the manifest;
- the manifest `version` matches `package.json`, and `docker_image` is tagged
  with it (the Release workflow writes all three).

## Publish in 5 steps

1. **Fork** this template (or use _Use this template_ on GitHub).
2. **Edit** the files in `src/devices/` and `gladys-assistant-integration.json` for your
   devices, and replace `docker_image` / `cover_image` with your own. Pick the
   manifest `categories` (Gladys 4.86+) your integration belongs to — 1 to 3
   keys among `climate`, `lighting`, `energy`, `security`, `multimedia`,
   `appliances`, `environment`, `protocols`, `network`, `notifications`,
   `assistants`, `services` — they are the catalog shelves the integration
   sits on (without them it only shows under "All" and in search). Declaring
   the field requires a `gladys_version` range starting at **4.86.0 or
   later** — older cores reject unknown manifest fields, and the store
   validator enforces the coupling. The template declares `lighting`,
   `security` and `environment` to match its demo devices. Keeping the scene
   and widget capability fields raises that minimum to **5.1.0** (see
   [above](#scene-triggers-scene-actions-and-dashboard-widgets)).
3. **Add the GitHub topic** `gladys-assistant-integration` to your repo.
4. **Release from the GitHub UI**: describe your changes under
   `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), then open
   **Actions → Release → Run workflow** and pick `patch`, `minor` or `major`.
   The workflow bumps the version everywhere (`package.json` + manifest
   `version`/`docker_image`, and the `docker_image` of the sub-containers
   running the integration's own image), moves the changelog section under
   the new version, pushes the `vX.Y.Z` tag, builds the `linux/amd64` + `linux/arm64`
   image to `ghcr.io` (`:X.Y.Z` and `:latest`), then publishes the GitHub
   Release of the tag with that changelog section as notes — the Gladys
   Supervision page links each version to the repository's releases. No local
   tag, no manual version edit.
5. The decentralized indexer picks up the new manifest `version` and Gladys
   offers a one-click install / update.

> Prefer the terminal? `git tag v1.0.0 && git push --tags` still works — the
> hand-pushed tag triggers the same multi-arch build and GitHub Release. This
> path only publishes the Docker tags and the Release, though: it does **not**
> touch `package.json`, `package-lock.json`, `CHANGELOG.md` or the manifest.
> Bump `version` in `package.json` and in `gladys-assistant-integration.json`
> (with the `docker_image` tag) and commit it **before** tagging, or the
> indexer will keep serving the old version. The Release workflow above does
> all of this for you.

Started from the template? Replace the entries of `CHANGELOG.md` with your
own, and turn on **Private vulnerability reporting** in the repository's
security settings: [`SECURITY.md`](SECURITY.md) sends reporters there.

Full documentation: <https://gladysassistant.com> (integrations developer guide).

## Notes

- Requires **Node.js ≥ 22** (uses the built-in global `fetch`; no HTTP dep).
- All external identifiers are prefixed with `ext:<selector>:` — always build
  them with `gladys.externalIds(type, platformId)` (or the lower-level
  `gladys.externalId(suffix)`); the server rejects anything else. Derive
  `platformId` from the unique id the external platform gives you (serial,
  cloud id, MAC…), never from a hard-coded label.
- `has_feedback: true` features should publish the state **confirmed by the
  device**; the template publishes the requested value for simplicity.
- Replace `cover.png` with your own 800×534 px image (≤150 KB, PNG or JPEG)
  before publishing. The bundled one is a plain gradient placeholder.

## License

Apache-2.0
