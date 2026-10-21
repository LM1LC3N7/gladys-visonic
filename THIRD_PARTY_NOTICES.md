# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## pyvisonic

<https://github.com/davesmeghead/pyvisonic> (package `pyvisonic`, version
4.0.8 of 2026-10-19, `__version__` of the clone), by DaveSmegHead
(davesmeghead, its `pyproject.toml` author) and its contributors, the library
of the Home Assistant Visonic integration
(<https://github.com/davesmeghead/visonic>). Its own credits: based on the
DomotiGa and Vera implementations, initial setup by Wouter Wolkers and
Alexander Kuiper, converted to a Python module by Wouter Wolkers and David
Field.

MIT License (`LICENSE` of the repository). The copyright line of that file is
the one of the Python packaging template it was started from; it is
reproduced below exactly as published:

```
Copyright (c) 2018 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported from `src/pyvisonic/`:

- `py_checksum.py`, `py_types_receiving.py`, `py_visonic_protocol_base.py`,
  `py_visonic_despatcher.py`, in `src/visonic/frame.js`: the frame layout
  (0D, type, data, checksum, 0A), the checksum and its tolerated variants
  (+1, and -1 for the known types), the length of each message type (fixed,
  up to the footer, or given in the frame), the types the panel wants
  acknowledged, the skipped types 00 and FD, the 240-byte limit, the 2 s
  limit between two chunks of one frame.
- `py_types_sending.py`, `py_visonic.py`, `py_partition_state.py`,
  `py_visonic_message_handling.py`, `py_enum.py`, `py_sensor_types.py`, in
  `src/visonic/protocol.js`: the status requests (A2 with 0x3F or 0x08),
  the arming and disarming command (A1, its mode codes, the 4-digit user
  code as two bytes, 0x07 for every partition), the system states and flags
  of A5 04, the zone masks of A5 01, 02, 03 and 06, the zone events of
  A5 04, the A7 events (intrusion, fire, panic, emergency, gas, flood, their
  restores, panel tamper) and pyvisonic's rule for an alarm in Standard mode.
- `py_visonic_protocol_base.py`, `py_visonic_sequencer.py`,
  `client_connection_test.py`, in `src/visonic/client.js`: our acknowledge
  of every panel message that wants one (malformed ones included), the
  status request that proves the link, the status request after 25 s of
  idle line, the 120 s watchdog, the acknowledge or "access denied" of a
  command.

The in-memory panel of the tests (`test/helpers/fakeVisonic.js`) follows
the messages pyvisonic decodes and its own test vectors (`tests/`, same
repository and licence).

Changed: Standard mode only (no download of the panel memory, so no
download code; no Powerlink enrolment; no B0 requests; no camera images,
bypass, event log, sirens or outputs); TCP only, through a serial-to-network
adapter (no serial or USB link); the frames cut in one linear pass with a
running checksum, bounded; an unknown type accepted only with the exact
checksum or its +1 variant; one request at a time with the answer it
expects; a command never written after its deadline and its option read
again right before the write; a command never written while the
acknowledge of a status request may still come; after a command timed out,
an acknowledge is treated as ambiguous for 10 s; a command confirmed only by
the state read back; a user code refused by the panel never sent again by
itself; reconnection with growing waits (10 s to 5 min), kept across
restarts; a flood or too many malformed frames cut the link.
