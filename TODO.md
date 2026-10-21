# TODO - Visonic PowerMax / PowerMaster v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/fr.md`, `docs/en.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the main
  session posts one recap per wave in /t/10385.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 - core** (2026-10-21): own TCP client on `node:net`
      ported from pyvisonic 4.0.8 in its Standard mode (frames, checksum and
      its variants, acknowledges, status requests, keep-alive, watchdog, A1
      command); the panel and zone devices; read-only states and push
      buttons; arming always allowed, disarming opt-in; fresh read before a
      disarm, confirmation by the state read back; refused code stop and
      connection attempts persisted in `/data`; scene triggers
      `alarm_triggered`, `armed`, `disarmed`; scene actions `arm`, `disarm`;
      "Test the connection", "Allow a new try of the code"; fr/en. Tested
      against an in-memory panel only (checksum and framing checked against
      pyvisonic's own test vectors).
- [ ] **Milestone 2 - real panel**: run against a real PowerMax (and a
      PowerMaster) behind a serial-to-network adapter; capture real frames
      (anonymised, never a code) as fixtures; fix what differs (see below).
- [ ] **Milestone 3 - more**: partitions (PowerMaster, B0 messages),
      zones 33 to 64 (B0), zone names (A3 indexes into the panel's name
      table), mute siren behind the disarm option, bypass behind its own
      option, the event log, the panel model (3C, needs the download code:
      opt-in only).
- [ ] **Milestone 4 - first release**: Docker image check, Release workflow,
      topic, GHCR package public.

## To check on a real panel

- The order of the A5 messages after A2 0x3F, and whether the panel sends
  A5 01 / 02 / 03 by itself on a change (the client asks for all of them
  about every 5 minutes anyway).
- Whether the acknowledge of an A2 always comes before its A5 (the client
  waits up to 0.5 s for it before writing a command).
- That A1 with partitions 0x07 arms a panel without partitions (pyvisonic's
  default), and what it does on a panel with partitions.
- The answer to a wrong user code: 0x08 assumed (pyvisonic "access denied"),
  and whether repeated wrong codes lock the keypads.
- How fast the system status follows an accepted A1 (the confirmation reads
  it again until 4.5 s after the request).
- The alarm flag (0x80) of A5 04 while armed: pyvisonic's Standard mode
  rule, never seen here.
- A7 with a count of 0xFF: only the first pair is read, as pyvisonic does
  without partitions.
- Zone event 5 (motion) and the 30 s hold of a motion zone.

## Decisions

- **Own client, no dependency**: no maintained Visonic client on npm; the
  logic of pyvisonic (MIT) is ported and credited in `THIRD_PARTY_NOTICES.md`
  (copied into the image with `LICENSE`). Runtime dependency: the SDK only.
- **pyvisonic's licence**: its `LICENSE` file is MIT with the copyright line
  of the Python packaging template ("Copyright (c) 2018 The Python Packaging
  Authority"). Reproduced exactly as published in `THIRD_PARTY_NOTICES.md`,
  with the real authors credited beside it (`pyproject.toml`: DaveSmegHead;
  the module header's credits).
- **Version 0.1.0, set by hand once**: the template ships 1.0.0; the sibling
  modules start at 0.1.x, so `package.json`, `package-lock.json`, the
  manifest `version` and the `docker_image` tag were set together to 0.1.0 in
  milestone 1, before any release (`test/manifest.test.js` checks all four).
  Every later version comes from Actions -> Release (the first patch release
  gives 0.1.1).
- **TCP only**: the container has no serial device; a serial-to-network
  adapter is the supported path (as the Home Assistant integration's TCP
  option). No serial, no USB.
- **Standard mode only**: the download of the panel memory needs the
  download code and puts the panel in a programming state; the Powerlink
  enrolment registers the integration in the panel as a Powerlink accessory
  (an imitation of a Visonic device, refused). So no download code field, no
  zone names from the memory, no panel identity, no partitions.
- **One panel state, commands on every partition (0x07)**: what pyvisonic
  sends when no partition is given, and the only state Standard mode gives
  without the memory of the panel.
- **No identity check**: nothing in Standard mode identifies the panel
  without the download code (3C needs it). A DHCP swap to another adapter at
  the same address cannot be seen: the docs ask for a fixed address. An
  unreadable or foreign peer never gives a valid status (checksums), so the
  link stays "no status from the panel".
- **Arming is protective**: always allowed (no option), out of the disarm
  queue, withdraws the disarms still waiting (in the app and in the client
  queue), sent even when the state cannot be read, never lowering the
  protection (arm stay over armed away sends nothing), never blocked by the
  waits between connection attempts (one attempt at once, `client.wake()`,
  never a second socket; the status that opens the session is its fresh
  read). It still needs the
  user code, and a refused code still stops it (a refused code is never
  replayed without a click).
- **Disarming**: opt-in (`allow_disarm`, false), read when asked, after the
  fresh read and in the client's check right before the socket write; one at
  a time; decided on the A5 04 read now (an unreadable state refuses it,
  nothing sent); refused in programming.
- **Deadlines**: read by 2.5 s, written by 3.5 s, answered and confirmed by
  4.5 s after the request (Gladys waits 5 s). The ack never waits for a
  publication to Gladys (states and events go through the guard chain).
- **Confirmation**: the acknowledge (02) only says the panel took the frame;
  the command is reported done only when A5 04 read back shows it (arming in
  the asked mode counts). Otherwise "acknowledged, but the state read back
  does not show it yet", and a read back at 2 s.
- **Owed acknowledge**: when a status reply came before the acknowledge of
  its request, a command waits up to 0.5 s for that acknowledge, so it never
  passes for the command's own. After a command timed out, an acknowledge or
  denial is ambiguous for 10 s (as gladys-satel-integra).
- **Refused code**: "access denied" (0x08) to A1, or a late one within 14.5 s
  of a command with the current code, persists `codeStop` (date only). Lifted
  by a new code or the "Allow a new try of the code" button (a click), never
  by a restart nor by "Test the connection".
- **No reads faster than the interval**: "Test the connection" reports from
  memory and sends nothing; Discovery publishes from the configuration; a
  Gladys reconnection republishes status, devices, states and transports
  without touching the panel; an unchanged configuration does not reconnect.
  Connection attempts: 10 s to 5 min, the last attempt and the failures kept
  in `/data` (written at most once a minute) so a restart waits its turn.
- **Late events**: every client event is queued with the session it belongs
  to; a new configuration starts a new session and the client's generation
  drops the frames of the old socket.
- **Alarm in Standard mode**: pyvisonic's rules: flag 0x80 of A5 04 while
  armed out of the entry delay, A7 intrusion events while armed (alarm delay
  only after an entry delay), fire / panic / emergency / gas / flood events,
  their restores, a disarm; cleared after 20 minutes (pyvisonic's bell time)
  when the panel never restores it.
- **Frames**: one linear pass with a running sum; known lengths from
  pyvisonic; up-to-the-footer only for the short control messages and the
  unknown types (exact or +1 checksum), bounded to 240 bytes; a partial
  frame older than 2 s dropped; malformed frames that want an acknowledge
  still get one (pyvisonic); 50 malformed in a row or 200 frames in a second
  cut the link.
- **Zones**: 1 to 32 (A5 masks); a motion zone shows 30 s after zone event 5;
  names "Zone n" (no memory download).
- **Rate limits**: one publisher for the whole integration (240 states per
  minute, 60 kept for the panel), shared with gladys-satel-integra.
- **Cover**: generated by `scripts/cover.mjs` in plain Node (no brand logo).
- **Validator**: `npx github:GladysAssistant/integration-store .` cannot be
  run from the development agent: to be run by the main session
  (`validate.ps1`).
