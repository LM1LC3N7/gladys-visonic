# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-21

### Added

- Local connection to Visonic PowerMax and PowerMaster panels over TCP,
  through a serial-to-network adapter wired to the serial port of the panel,
  in the Standard mode of pyvisonic 4.0.8: frames, checksum, acknowledges,
  status requests, keep-alive and watchdog.
- The panel as one device: read-only state (disarmed, arming, entry delay,
  armed away, armed stay, programming), armed, ready, trouble, panel tamper,
  alarm in progress, fire alarm, link, and arm away / arm stay / disarm push
  buttons (never a switch).
- One device per configured zone (1 to 32): open (opening, smoke, leak) or
  motion, tamper, low battery, alarm, bypassed.
- Scene triggers `alarm_triggered` (kind, zone, fire), `armed`, `disarmed`;
  scene actions `arm` and `disarm`; "Test the connection" and "Allow a new
  try of the code" buttons.
- State and scene event budgets under the Gladys limits.
- French and English names, messages and guides; a cover generated in plain
  Node (`npm run cover`).

### Security

- Arming always allowed (it protects), never lowering the protection, never
  queued behind a disarm (it withdraws the disarms still waiting), never
  blocked by an unreadable state nor by the waits between connection
  attempts (one attempt at once). Disarming off by default, behind its own
  option, read when asked, again after the fresh read, and once more right
  before the write.
- A disarm decided on the state read from the panel just before it, one at a
  time, written within 3.5 s or not at all; a command reported done only
  when the state read back shows it; one that may have left is reported
  "sent, without confirmation" and read again; after a command timed out, an
  acknowledge is treated as ambiguous for 10 s; a command never written while
  the acknowledge of a status request may still come.
- A user code refused by the panel ("access denied", even late) stops the
  commands, kept across restarts in `/data` (the date only, never the code);
  lifted by a new code or by "Allow a new try of the code". The code is
  never logged.
- Standard mode only: no download code, no download of the panel memory, no
  Powerlink enrolment. TCP only.
- Connection attempts spaced (10 s to 5 min) and kept in `/data` (written at
  most once a minute), so a restart loop never connects faster; "Test the
  connection", Discovery, a Gladys reconnection or an unchanged
  configuration never read the panel nor reconnect; a late event of an older
  session publishes nothing.
- Bounded frames, linear parsing with a running checksum; a flood or too
  many malformed frames cut the link; no control byte in the files (test).

### Fixed

- An arm is never held behind a status read without answer or a disarm not
  acknowledged: it takes the line (review 1).
- An arm stay on an unreadable state never lowers an arm away; two arms at
  once never end on the weaker one.
- A disarm on a state the integration does not know is refused.
- Bytes the adapter may have kept before the connection are never read as
  the current state.
- Frames written at least 190 ms apart (pyvisonic), acknowledges included.
- F1, F4 and E1 frames are cut by their length (pyvisonic); an acknowledge
  or an access denied is never lost inside a broken frame.
- One `alarm_triggered` per kind per 30 s at most; an alarm already in
  progress at start is announced; 0x0B logged once a minute.
- "Code refused" when the panel acknowledges then refuses; an ambiguous
  acknowledge is decided by the state read back; a command whose session
  changed is never reported done; a restart after a working session waits
  25 s; at most one wake per 5 s; old states never published by a new
  session.

- A request waiting for its slot on the line keeps its deadline (the answer
  to Gladys always comes in time); at most two acknowledges go before it;
  100 malformed frames a minute cut the link (review 2). Every frame is
  decoded; at most 50 acknowledges wait, the extra ones are not sent, and
  the link is cut only after 30 s at that cap (review 3).
- After a disarm with no known outcome, an arm is never "nothing sent";
  an arm away is never held back; alarm events received at the connection
  are read.

[Unreleased]: https://github.com/LM1LC3N7/gladys-visonic/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-visonic/releases/tag/v0.1.1
