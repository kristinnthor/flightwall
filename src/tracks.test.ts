import { describe, it, expect } from 'vitest';
import { TrackStore } from './tracks';
import type { Aircraft } from './types';

/** Minimal airborne target; only hex/lat/lon/altitude matter to the store. */
function ac(hex: string, lat: number, lon: number, altitudeFt = 30000): Aircraft {
  return {
    hex,
    callsign: null,
    registration: null,
    typeCode: null,
    altitudeFt,
    groundSpeedKt: null,
    verticalRateFpm: null,
    distanceKm: 0,
    bearingDeg: 0,
    track: null,
    lat,
    lon,
  };
}

const MINUTE = 60_000;

describe('TrackStore.append', () => {
  it('records a point per aircraft per poll', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21)], 1000);
    s.append([ac('a', 64.1, -21)], 6000);
    const track = s.get('a');
    expect(track).toHaveLength(2);
    expect(track[0]).toEqual({ lat: 64, lon: -21, altitudeFt: 30000, t: 1000 });
    expect(track[1]!.t).toBe(6000);
  });

  it('keeps points in chronological order', () => {
    const s = new TrackStore();
    for (let i = 0; i < 5; i++) s.append([ac('a', 64 + i * 0.1, -21)], i * 5000);
    expect(s.get('a').map((p) => p.t)).toEqual([0, 5000, 10000, 15000, 20000]);
  });

  it('tracks several aircraft independently', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21), ac('b', 65, -20)], 1000);
    s.append([ac('a', 64.1, -21)], 6000);
    expect(s.get('a')).toHaveLength(2);
    expect(s.get('b')).toHaveLength(1);
  });

  it('returns an empty track for an unknown hex', () => {
    expect(new TrackStore().get('nope')).toEqual([]);
  });

  it('records altitude alongside position', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21, 12500)], 1000);
    expect(s.get('a')[0]!.altitudeFt).toBe(12500);
  });
});

describe('TrackStore de-duplication', () => {
  it('skips a point that has barely moved', () => {
    const s = new TrackStore({ minMoveKm: 0.05 });
    s.append([ac('a', 64, -21)], 1000);
    s.append([ac('a', 64.0001, -21)], 6000); // ~11 m
    expect(s.get('a')).toHaveLength(1);
  });

  it('records a point once it clears the threshold', () => {
    const s = new TrackStore({ minMoveKm: 0.05 });
    s.append([ac('a', 64, -21)], 1000);
    s.append([ac('a', 64.001, -21)], 6000); // ~111 m
    expect(s.get('a')).toHaveLength(2);
  });

  it('compares against the last recorded point, not the previous poll', () => {
    // Three sub-threshold hops that together clear it must still register.
    const s = new TrackStore({ minMoveKm: 0.05 });
    s.append([ac('a', 64, -21)], 1000);
    s.append([ac('a', 64.0003, -21)], 2000);
    s.append([ac('a', 64.0006, -21)], 3000);
    expect(s.get('a').length).toBeGreaterThan(1);
  });
});

describe('TrackStore.prune', () => {
  it('drops points older than the window and keeps newer ones', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21)], 0);
    s.append([ac('a', 64.1, -21)], 30 * MINUTE);
    s.append([ac('a', 64.2, -21)], 50 * MINUTE);
    s.prune(60 * MINUTE, 45 * MINUTE); // cutoff at 15 min
    expect(s.get('a').map((p) => p.t)).toEqual([30 * MINUTE, 50 * MINUTE]);
  });

  // The reason this feature exists: you want to see where a plane went after
  // it left the radius, so retention cannot depend on the latest snapshot.
  it('keeps the trail of an aircraft that has left the radius', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21), ac('b', 65, -20)], 0);
    s.append([ac('a', 64.1, -21)], 10 * MINUTE); // 'b' is gone from the snapshot
    s.prune(10 * MINUTE, 60 * MINUTE);
    expect(s.get('b')).toHaveLength(1);
  });

  it('removes a track only once every point has aged out', () => {
    const s = new TrackStore();
    s.append([ac('b', 65, -20)], 0);
    s.prune(30 * MINUTE, 60 * MINUTE);
    expect(s.tracks().has('b')).toBe(true);
    s.prune(90 * MINUTE, 60 * MINUTE);
    expect(s.tracks().has('b')).toBe(false);
    expect(s.get('b')).toEqual([]);
  });

  it('drops everything at a zero window, so trailMinutes=0 shows no trail', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21)], 0);
    s.append([ac('a', 64.1, -21)], 5000);
    s.prune(10000, 0);
    expect(s.tracks().size).toBe(0);
  });

  it('is a no-op when nothing has expired', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21)], 1000);
    s.prune(2000, 60 * MINUTE);
    expect(s.get('a')).toHaveLength(1);
  });
});

describe('TrackStore memory guards', () => {
  it('caps points per track, evicting oldest first', () => {
    const s = new TrackStore({ maxPoints: 3 });
    for (let i = 0; i < 6; i++) s.append([ac('a', 64 + i * 0.1, -21)], i * 1000);
    const track = s.get('a');
    expect(track).toHaveLength(3);
    expect(track.map((p) => p.t)).toEqual([3000, 4000, 5000]);
  });

  it('caps total tracks, evicting the least recently seen', () => {
    const s = new TrackStore({ maxTracks: 2 });
    s.append([ac('a', 64, -21)], 1000);
    s.append([ac('b', 65, -20)], 2000);
    s.append([ac('c', 66, -19)], 3000);
    expect(s.tracks().has('a')).toBe(false);
    expect(s.tracks().has('b')).toBe(true);
    expect(s.tracks().has('c')).toBe(true);
  });

  it('does not evict a stationary aircraft that is still being seen', () => {
    // 'a' never moves far enough to record a point, but it is still up there.
    const s = new TrackStore({ maxTracks: 2, minMoveKm: 0.05 });
    s.append([ac('a', 64, -21)], 1000);
    s.append([ac('b', 65, -20)], 2000);
    s.append([ac('a', 64.00001, -21)], 3000); // seen again, sub-threshold
    s.append([ac('c', 66, -19)], 4000);
    expect(s.tracks().has('a')).toBe(true);
    expect(s.tracks().has('b')).toBe(false);
  });

  it('never exceeds the track cap across many aircraft', () => {
    const s = new TrackStore({ maxTracks: 10 });
    for (let i = 0; i < 50; i++) s.append([ac(`h${i}`, 64 + i * 0.01, -21)], i * 1000);
    expect(s.tracks().size).toBe(10);
  });
});

describe('TrackStore.tracks', () => {
  it('exposes every live track', () => {
    const s = new TrackStore();
    s.append([ac('a', 64, -21), ac('b', 65, -20)], 1000);
    expect(new Set(s.tracks().keys())).toEqual(new Set(['a', 'b']));
  });

  it('is empty before anything is appended', () => {
    expect(new TrackStore().tracks().size).toBe(0);
  });
});
