// -----------------------------------------------------------------------------
// States and scene events to Gladys, under the host API limits (300 states
// and 300 events per minute per integration).
//
// Shared with LM1LC3N7/gladys-satel-integra, gladys-envisalink and
// gladys-risco (same author, same licence). One publisher for the whole
// integration: every publication goes through its one chain and its one
// budget, so simultaneous publications never exceed it.
//
// A panel can be chatty (a motion zone opens and closes all day):
// - only a value that differs from the last one Gladys accepted is queued,
//   plus a heartbeat of each unchanged value every 30 minutes, offset per
//   feature over 5 minutes so that the heartbeats never come in one burst;
// - a per-minute budget, of which a part only the panel and the partitions
//   (mode, alarm, panic…) may use: a storm of zone changes never delays an
//   alarm; over the budget, the latest value of each feature waits for the
//   next minute instead of being refused by Gladys;
// - scene events: alarm_triggered is never dropped and is tried again (3
//   tries within the minute) on a network error or a 429; the other events
//   over their budget are dropped and logged (a storm of transitions is a
//   fault, not news).
// -----------------------------------------------------------------------------

import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';

const WINDOW = 60_000;
/** publishStates takes at most 100 states per request. */
const BATCH = 100;

export class Budget {
  constructor(perMinute, now) {
    this.perMinute = perMinute;
    this.now = now;
    this.entries = [];
  }

  prune() {
    const limit = this.now() - WINDOW;
    while (this.entries.length > 0 && this.entries[0].at <= limit) this.entries.shift();
  }

  get left() {
    this.prune();
    return this.perMinute - this.entries.reduce((sum, entry) => sum + entry.count, 0);
  }

  /** When the oldest spending leaves the window (ms from now). */
  get wait() {
    this.prune();
    return this.entries.length === 0 ? 0 : Math.max(1, this.entries[0].at + WINDOW - this.now());
  }

  spend(count) {
    if (count > 0) this.entries.push({ at: this.now(), count });
  }
}

/** Zones are the chatty features; the panel has priority. */
export const isPriority = (externalId) => !externalId.includes(':zone:');

/** A stable offset in [0, spread) per feature id. */
function offset(id, spread) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % spread;
}

/**
 * The SDK refuses an event variable whose value is undefined (the whole
 * event is then lost, alarm_triggered included): an unknown value is sent
 * as null.
 */
export const definedValues = (data = {}) =>
  Object.fromEntries(
    Object.entries(data ?? {}).map(([key, value]) => [key, value === undefined ? null : value]),
  );

const valueKey = (state) => JSON.stringify([state.state ?? null, state.text ?? null]);

export class StatePublisher {
  constructor({ gladys, logger, now = Date.now, timers = globalThis }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.budget = new Budget(LIMITS.statesPerMinute, now);
    this.events = new Budget(LIMITS.eventsPerMinute, now);
    /** feature external id -> { key, at }: the last value Gladys accepted. */
    this.last = new Map();
    /** feature external id -> state entry, the latest value only. */
    this.pending = new Map();
    this.chain = Promise.resolve();
    this.timer = undefined;
    this.retries = new Set();
    /** feature external id -> value key of the request on its way to Gladys. */
    this.inflight = new Map();
    /** Ids forgotten while their value was on its way: not remembered after it lands. */
    this.forgotten = new Set();
  }

  heartbeat(id) {
    return TIMINGS.stateHeartbeat + offset(id, TIMINGS.heartbeatSpread);
  }

  /** Queues the states that changed (or whose heartbeat is due), then sends what the budget allows. */
  publish(states) {
    const now = this.now();
    for (const state of states) {
      const id = state.device_feature_external_id;
      const key = valueKey(state);
      const sending = this.inflight.get(id);
      if (sending !== undefined) {
        // A value of this feature is on its way: compare with it, never with
        // the older accepted one (Gladys will hold what is being sent).
        if (sending === key) this.pending.delete(id);
        else {
          this.pending.delete(id);
          this.pending.set(id, state);
        }
        continue;
      }
      const last = this.last.get(id);
      const same = last && last.key === key;
      if (same && now - last.at < this.heartbeat(id)) {
        // Back to the value Gladys has: a change still waiting is void.
        this.pending.delete(id);
        continue;
      }
      // Re-inserted at the end: the order of the changes is kept.
      this.pending.delete(id);
      this.pending.set(id, state);
    }
    return this.flush();
  }

  /** Gladys lost these values (a device created or updated, a reconnection): send them again. */
  forget(externalId) {
    const matches = (id) =>
      externalId === undefined || id === externalId || id.startsWith(`${externalId}:`);
    // A value on its way may land after the device was created or Gladys
    // restarted: it must not count as known (as publishChangedStates of the SDK).
    for (const id of this.inflight.keys()) if (matches(id)) this.forgotten.add(id);
    if (externalId === undefined) {
      this.last.clear();
      return;
    }
    for (const id of this.last.keys()) {
      if (matches(id)) this.last.delete(id);
    }
  }

  flush() {
    this.chain = this.chain.then(() => this.send()).catch(() => undefined);
    return this.chain;
  }

  async send() {
    if (this.pending.size === 0) return;
    const left = this.budget.left;
    const entries = [...this.pending.values()];
    const priority = entries.filter((s) => isPriority(s.device_feature_external_id));
    const zones = entries.filter((s) => !isPriority(s.device_feature_external_id));
    const first = priority.slice(0, Math.max(0, left));
    // The zones never eat the part kept for the panel and the partitions.
    const zoneRoom = Math.max(0, left - LIMITS.priorityStates - first.length);
    const batch = [...first, ...zones.slice(0, zoneRoom)];
    if (batch.length === 0) {
      this.later();
      return;
    }
    for (const state of batch) this.pending.delete(state.device_feature_external_id);
    for (let i = 0; i < batch.length; i += BATCH) {
      const part = batch.slice(i, i + BATCH);
      for (const state of part) {
        this.inflight.set(state.device_feature_external_id, valueKey(state));
      }
      try {
        await this.gladys.publishStates(part);
        const at = this.now();
        for (const state of part) {
          const id = state.device_feature_external_id;
          if (this.forgotten.delete(id)) {
            // Gladys lost it meanwhile (device created, reconnection): queued again.
            this.last.delete(id);
            if (!this.pending.has(id)) this.pending.set(id, state);
          } else {
            this.last.set(id, { key: valueKey(state), at });
          }
          this.inflight.delete(id);
        }
      } catch (err) {
        for (const state of part) {
          this.inflight.delete(state.device_feature_external_id);
          this.forgotten.delete(state.device_feature_external_id);
        }
        this.logger.warn(`Publishing the states failed: ${err.message}`);
        // Kept for the next try, unless a newer value arrived meanwhile.
        for (const state of part) {
          if (!this.pending.has(state.device_feature_external_id)) {
            this.pending.set(state.device_feature_external_id, state);
          }
        }
      }
      this.budget.spend(part.length);
    }
    if (this.pending.size > 0) this.later();
  }

  later() {
    if (this.timer) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.budget.wait || 1_000);
  }

  async sceneEvent(key, data) {
    const critical = key === SCENE_TRIGGERS.ALARM_TRIGGERED;
    if (!critical && this.events.left <= 0) {
      this.logger.warn(
        `Scene event ${key} dropped: more than ${LIMITS.eventsPerMinute} per minute`,
      );
      return;
    }
    this.events.spend(1);
    await this.tryEvent(key, definedValues(data), critical ? 1 : LIMITS.alarmEventTries);
  }

  async tryEvent(key, data, attempt) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      if (attempt >= LIMITS.alarmEventTries) {
        this.logger.warn(`Scene event ${key} refused: ${err.message}`);
        return;
      }
      const wait = TIMINGS.alarmEventRetry[attempt - 1];
      this.logger.warn(`Scene event ${key} refused (${err.message}): new try in ${wait / 1000} s`);
      const timer = this.timers.setTimeout(() => {
        this.retries.delete(timer);
        this.tryEvent(key, data, attempt + 1);
      }, wait);
      this.retries.add(timer);
    }
  }

  /**
   * Stops the delayed state sends. The alarm_triggered retries survive a
   * restart of the panel session (new address or access code): an alarm that
   * happened must still reach the scenes. Only `final` (the container stops)
   * cancels them.
   */
  stop({ final = false } = {}) {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    // The values still waiting belong to the session that stops (maybe
    // another panel): never sent with the next one.
    this.pending.clear();
    if (final) {
      for (const timer of this.retries) this.timers.clearTimeout(timer);
      this.retries.clear();
    }
  }
}
