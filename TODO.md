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
- [x] **Review 1 fixes** (2026-10-21, xhigh review of 80f1458: 7 important,
      12 minor): see "Decisions after review 1" below.
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
- **To confirm**: whether the adapters keep bytes received while no client
  is connected and send them at the connection (the client ignores, while
  acknowledging, what comes in the first 500 ms, before its first A2), and
  whether 500 ms is enough.
- **To confirm**: that 190 ms between frames (pyvisonic PowerMax value, used
  for PowerMaster too) is enough, and not too slow for the deadlines.
- F1 (PowerMax+) and F4 (PowerMaster images): cut by pyvisonic's lengths,
  never read.
- The rescue of 02 / 08 inside a broken or unknown frame may take data
  bytes `0D 08 F7 0A` for a denial (a cautious effect: the code stops until
  a click). Check how often real broken frames hold such bytes.
- Whether a real panel ever sends more than 50 messages to acknowledge in a
  row (beyond, the extra acknowledges are not sent; the link is cut only
  after 30 s at the cap).

## Decisions after review 2

- **B1**: a request waiting for its slot keeps its deadline (`sendBy`, or
  its timeout) and is refused "late" at it; at most 2 acknowledges go
  before it, whatever is queued; more than 100 malformed frames in a minute
  cut the link (the acknowledge cap: see review 3).
- **I-A**: a disarm written less than 4.5 s ago and not confirmed makes the
  next arm never "nothing sent": the same level is sent again, a stronger
  one read (arm stay on armed away) gives an error "state uncertain", never
  a success.
- **I-B**: an arm away is never held back by `covered()`; an arm stay only
  by a strictly stronger state in memory or arm away written less than
  4.5 s ago; an arm whose outcome is not confirmed never covers a later one.
- **m1**: "an arming at least as strong" when an arm stay is refused behind
  an arm away. **m2**: A7 events of the first 500 ms are read (an alarm kept
  by the adapter is still an alarm). **m4**: a disarm whose read an arm took
  says so ("an arming in progress took the line").

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

## Decisions after review 1

- **I1 Arm preempts**: a protective request goes ahead of the queue (FIFO
  among arms) and preempts a non-protective request in flight: a status
  read is dropped, a disarm written and not acknowledged is reported "sent,
  without confirmation"; their late answers make the next acknowledge
  ambiguous (the state read back decides). Keep-alive and read back wait
  1.5 s at most. The arm reads the state by 1.5 s after the request.
- **I2 Unreadable state**: arm away sent blind; arm stay sent only when the
  last state known (memory, each A5 04) protects less, else refused,
  nothing sent.
- **I3 Arms in order**: an arm chain of their own (never behind disarms),
  and the check right before the write refuses an arm that the state in
  memory or an arm written less than 4.5 s ago (not refused) covers.
- **I4**: a disarm on an unknown system state is refused (raw code logged).
- **I5**: 500 ms after the TCP connection, frames are acknowledged and
  never read, then the first A2; after `wake()` the arm reads the state
  again (the opening status never decides "nothing sent"). To confirm on a
  real adapter.
- **I6**: one write queue for acknowledges and requests, 190 ms at least
  between two frames (pyvisonic PowerMax; PowerMaster 150 ms), the
  deadline and the check of a request run when its slot comes (M9).
- **I7**: F1 (9 bytes, checksum ignored), F4 (by subtype), E1 (7 bytes) from
  pyvisonic; an acknowledge or a denial inside a broken or unknown frame
  is still read.
- **Ambiguous acknowledge**: the state read back decides (done if it shows
  the command, "sent, without confirmation" otherwise); a denial, even
  ambiguous or after an acknowledge, gives "code refused" (M3) and stops
  the code.
- **M1**: one `alarm_triggered` per kind per 30 s at most (the state
  features follow every change; the dropped ones logged once a minute).
- **M2**: 0x0B logged once, then counted once a minute. **M4**: a read that
  timed out without its acknowledge makes the next acknowledge ambiguous.
  **M5**: the write buffer is checked after every frame, acknowledges too.
  **M6**: the states still waiting when a session stops are dropped.
  **M7**: a command whose session changed after its write is never
  "done". **M8**: after a session that worked, a restart waits 25 s; at
  most one `wake()` per 5 s. **M10**: an alarm in progress at the first
  status seen fires `alarm_triggered`.
- **M11 (not done)**: a fingerprint of the panel from the enrolled zones of
  A5 06 is left for milestone 2 (an enrolment change would refuse the
  disarm: to weigh on a real panel).

## Decisions after review 3

- **R-1**: a frame is always decoded, whatever happens to its acknowledge.
  At most 50 acknowledges wait for the line (about 9.5 s); beyond, the extra
  one is not queued (the frame is still read; a panel that sends it again
  only gives a duplicate), counted and logged once a minute. The link is cut
  only when the queue stays at the cap 30 s in a row, after the frame in
  hand is decoded. The guards of 100 malformed frames a minute and 200
  frames a second stay.
