# Visonic PowerMax / PowerMaster for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com):
**Visonic PowerMax and PowerMaster** alarm panels, **locally** over TCP
through a **serial-to-network adapter** wired to the serial port of the
panel, with the protocol of the open-source
[pyvisonic](https://github.com/davesmeghead/pyvisonic) library (Visonic
publishes none).

> **Never tested with a real device.** Unofficial, not affiliated with
> Visonic.

- Panel: state (disarmed, arming, entry delay, armed away, armed stay,
  programming), armed, ready, trouble, panel tamper, alarm in progress, fire
  alarm, link; arm away, arm stay and disarm **buttons**.
- Zones (the ones you list, 1 to 32): open (opening, smoke, leak) or motion,
  tamper, low battery, alarm, bypassed.
- Scene triggers: alarm triggered (intrusion, fire, panic, emergency, gas,
  flood), armed, disarmed. Scene actions: arm, disarm.
- Safety: arming always allowed (never lowering the protection);
  **disarming off by default**, behind its own option read again right
  before the write; a disarm decided on the state read from the panel right
  before it; a command reported done only when the state read back shows
  it; the 4-digit user code is a secret field, never logged; a refused code
  is never sent again by itself, even across restarts.
- Standard mode only: no download of the panel memory (no download code), no
  Powerlink enrolment; TCP only (no serial or USB link). Everything,
  the user code included, travels in clear text on the local network: see
  the guides.

User guides: [français](docs/fr.md), [English](docs/en.md).

## Development

```bash
npm install
npm test               # node --test (Node 22 and 24), against an in-memory panel
npm run lint
npm run format:check
npm run audit          # npm audit --omit=dev
npm run cover          # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .
```

Layout: `src/visonic/` (frames, protocol, TCP client), `src/app.js`
(devices, states, scene events, commands), `src/devices.js`,
`src/publisher.js` (rate limits), `test/helpers/fakeVisonic.js` (the
simulated panel). See `CLAUDE.md` and `TODO.md`.

## Credits and licence

Apache-2.0 (`LICENSE`). The protocol is ported from
[pyvisonic](https://github.com/davesmeghead/pyvisonic) 4.0.8 by davesmeghead
and contributors (MIT): see `THIRD_PARTY_NOTICES.md`.
