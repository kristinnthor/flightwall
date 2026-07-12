import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollLoop, backoffDelay, computeStatus, type Snapshot } from './state';
import type { Aircraft } from './types';

const CFG = { lat: 64, lon: -21, radiusKm: 50 };

function ac(hex: string, distanceKm: number): Aircraft {
  return {
    hex, callsign: hex.toUpperCase(), registration: null, typeCode: null,
    altitudeFt: 30000, groundSpeedKt: 400, verticalRateFpm: 0,
    distanceKm, bearingDeg: 0, lat: 64, lon: -21,
  };
}

describe('backoffDelay', () => {
  const noJitter = () => 0.5; // jitter factor 1.0
  it('doubles from base and caps at 300s', () => {
    expect(backoffDelay(1, 5000, noJitter)).toBe(5000);
    expect(backoffDelay(2, 5000, noJitter)).toBe(10000);
    expect(backoffDelay(7, 5000, noJitter)).toBe(300_000);
    expect(backoffDelay(20, 5000, noJitter)).toBe(300_000);
  });
  it('jitters within ±20%', () => {
    expect(backoffDelay(1, 5000, () => 0)).toBe(4000);
    expect(backoffDelay(1, 5000, () => 1)).toBe(6000);
  });
});

describe('computeStatus', () => {
  it.each([
    [0, 'live'], [14_999, 'live'], [15_000, 'stale'], [59_999, 'stale'], [60_000, 'lost'],
  ] as const)('age %s → %s', (age, status) => {
    expect(computeStatus(1_000_000, 1_000_000 + age)).toBe(status);
  });
});

describe('PollLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeLoop(fetchImpl: () => Promise<Aircraft[]>, extra: Record<string, unknown> = {}) {
    const updates: Snapshot[] = [];
    const loop = new PollLoop({
      provider: { fetchAircraft: fetchImpl },
      config: CFG,
      onUpdate: (s) => updates.push(s),
      now: () => Date.now(),
      random: () => 0.5,
      ...extra,
    });
    return { loop, updates };
  }

  it('emits sorted snapshot and diffs entered/left across ticks', async () => {
    let call = 0;
    const { loop, updates } = makeLoop(async () => {
      call++;
      return call === 1 ? [ac('b', 20), ac('a', 5)] : [ac('a', 6), ac('c', 1)];
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates[0]?.aircraft.map((a) => a.hex)).toEqual(['a', 'b']);
    expect([...updates[0]!.entered].sort()).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(updates[1]?.aircraft.map((a) => a.hex)).toEqual(['c', 'a']);
    expect([...updates[1]!.entered]).toEqual(['c']);
    expect([...updates[1]!.left]).toEqual(['b']);
    loop.stop();
  });

  it('backs off on failure and recovers', async () => {
    let call = 0;
    const { loop, updates } = makeLoop(async () => {
      call++;
      if (call <= 2) throw new Error('boom');
      return [ac('a', 5)];
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);      // call 1 fails → retry in 5s
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);   // call 2 fails → retry in 10s
    await vi.advanceTimersByTimeAsync(9999);
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);      // call 3 succeeds
    expect(updates).toHaveLength(1);
    loop.stop();
  });

  it('skips polls while hidden and resumes when visible', async () => {
    let hidden = true;
    const fetcher = vi.fn(async () => [ac('a', 5)]);
    const { loop } = makeLoop(fetcher, { isHidden: () => hidden });
    loop.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('stop() prevents further ticks', async () => {
    const fetcher = vi.fn(async () => []);
    const { loop } = makeLoop(fetcher);
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    loop.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stop() during in-flight fetch discards the tick', async () => {
    let resolveFetch!: (v: Aircraft[]) => void;
    const pending = new Promise<Aircraft[]>((resolve) => {
      resolveFetch = resolve;
    });
    const { loop, updates } = makeLoop(() => pending);
    loop.start(); // synchronously calls fetchAircraft and suspends on the await
    loop.stop();
    resolveFetch([ac('a', 5)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toHaveLength(0);
  });

  it('start() is idempotent', async () => {
    const fetcher = vi.fn(async () => [ac('a', 5)]);
    const { loop } = makeLoop(fetcher);
    loop.start();
    loop.start(); // no-op: loop is already running
    await vi.advanceTimersByTimeAsync(10_000);
    // single 5s cadence: calls at t=0, 5s, 10s — not doubled to 6
    expect(fetcher).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it('nextTickDueAt tracks scheduled backoff and start()', async () => {
    let call = 0;
    const { loop } = makeLoop(async () => {
      call++;
      if (call === 1) throw new Error('boom');
      return [ac('a', 5)];
    });
    loop.start();
    const startNow = Date.now();
    expect(loop.nextTickDueAt).toBeLessThanOrEqual(startNow);
    await vi.advanceTimersByTimeAsync(0); // call 1 fails → backoff(1, 5000, 0.5) = 5000ms
    expect(loop.nextTickDueAt).toBe(Date.now() + 5000);
    loop.stop();
  });

  it('stop()+start() during in-flight fetch discards the stale tick', async () => {
    let call = 0;
    let resolveFirst!: (v: Aircraft[]) => void;
    const firstPromise = new Promise<Aircraft[]>((resolve) => {
      resolveFirst = resolve;
    });
    const { loop, updates } = makeLoop(async () => {
      call++;
      if (call === 1) return firstPromise;
      return [ac('b', 5)];
    });

    loop.start(); // tick #1 in flight, awaiting firstPromise
    loop.stop();
    loop.start(); // restarted chain kicks off tick #2

    await vi.advanceTimersByTimeAsync(0);
    expect(updates.some((u) => u.aircraft.some((a) => a.hex === 'b'))).toBe(true);

    resolveFirst([ac('zzz', 99)]); // stale tick #1 resolves after the restart
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.some((u) => u.aircraft.some((a) => a.hex === 'zzz'))).toBe(false);

    loop.stop();
  });
});
