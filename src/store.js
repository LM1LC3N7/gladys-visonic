// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
// - the stop after the panel refused the user code, so a restart never sends
//   a refused code again (wrong codes may lock the keypads or be reported to
//   the alarm monitoring company);
// - the instant of the last connection attempt and how many failed in a
//   row, so a container restarting in a loop never connects faster than the
//   waits between attempts (written at most once a minute).
// Never the code itself, nor anything derived from it (a 4-digit code is
// brute-forced from any hash). The file is readable by the container user
// only (0600).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';

export const STATE_FILE = '/data/visonic-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        // A state file is a few dozen bytes: anything big is not ours.
        return text.length > 4096 ? null : JSON.parse(text);
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** In-memory store, for the tests. */
export function memoryStore(initial = null) {
  let data = initial;
  let saves = 0;
  return {
    async load() {
      return data === null ? null : JSON.parse(JSON.stringify(data));
    },
    async save(next) {
      saves += 1;
      data = JSON.parse(JSON.stringify(next));
    },
    get data() {
      return data;
    },
    get saves() {
      return saves;
    },
  };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The persisted state, repaired: { codeStop: { at } | null, lastAttemptAt,
 * failures }. Any stop found, even malformed, is kept: a doubt never sends a
 * refused code again. A time read back is capped at `now` (a clock that
 * jumped, or a hand-edited file, never delays the connection for longer).
 */
export function normalizeMemory(raw, now = Date.now()) {
  // Own properties only: nothing comes from a prototype.
  const own = (key) =>
    raw !== null && typeof raw === 'object' && Object.hasOwn(raw, key) ? raw[key] : undefined;
  const stop = own('codeStop');
  const present =
    stop !== null && stop !== undefined && typeof stop === 'object' && !Array.isArray(stop);
  return {
    codeStop: present
      ? { at: Math.min(finite(Object.hasOwn(stop, 'at') ? stop.at : 0), now) }
      : null,
    lastAttemptAt: Math.min(finite(own('lastAttemptAt')), now),
    failures: Math.min(Math.max(0, Math.floor(finite(own('failures')))), 20),
  };
}
