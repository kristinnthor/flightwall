import { describe, it, expect } from 'vitest';
import { makeProjector, ringRadiiKm, placeLabels } from './mapproject';
import type { Config } from '../types';

const cfg = (radiusKm: number): Config => ({ lat: 64, lon: -21, radiusKm });

describe('makeProjector', () => {
  it('puts home at the scope centre', () => {
    const p = makeProjector(cfg(100), 960, 540, 400);
    const { x, y } = p(64, -21);
    expect(x).toBeCloseTo(960, 6);
    expect(y).toBeCloseTo(540, 6);
  });

  it('puts a target at the configured radius on the outer ring, due north', () => {
    const radiusKm = 100;
    const p = makeProjector(cfg(radiusKm), 960, 540, 400);
    // 100 km north of 64N, in degrees of latitude
    const dLat = (radiusKm / 6371) * (180 / Math.PI);
    const { x, y } = p(64 + dLat, -21);
    expect(x).toBeCloseTo(960, 6);
    expect(y).toBeCloseTo(140, 3); // 540 - 400
  });

  it('flips y so north is up and keeps east to the right', () => {
    const p = makeProjector(cfg(100), 960, 540, 400);
    expect(p(65, -21).y).toBeLessThan(540);
    expect(p(63, -21).y).toBeGreaterThan(540);
    expect(p(64, -20).x).toBeGreaterThan(960);
    expect(p(64, -22).x).toBeLessThan(960);
  });

  it('scales with the scope radius, not the config radius alone', () => {
    const small = makeProjector(cfg(100), 0, 0, 100);
    const large = makeProjector(cfg(100), 0, 0, 200);
    expect(large(64, -20).x).toBeCloseTo(small(64, -20).x * 2, 6);
  });
});

describe('ringRadiiKm', () => {
  it('ends exactly at the configured radius', () => {
    for (const r of [1, 5, 37, 50, 120, 250, 460]) {
      const rings = ringRadiiKm(r);
      expect(rings[rings.length - 1]).toBe(r);
    }
  });

  it('is strictly ascending and returns 2-4 rings across the config range', () => {
    for (let r = 1; r <= 460; r++) {
      const rings = ringRadiiKm(r);
      expect(rings.length).toBeGreaterThanOrEqual(2);
      expect(rings.length).toBeLessThanOrEqual(4);
      for (let i = 1; i < rings.length; i++) {
        expect(rings[i]!).toBeGreaterThan(rings[i - 1]!);
      }
      expect(rings[0]!).toBeGreaterThan(0);
    }
  });

  it('rounds inner rings onto readable values', () => {
    expect(ringRadiiKm(50)).toEqual([15, 30, 50]);
    expect(ringRadiiKm(120)).toEqual([40, 75, 120]);
    expect(ringRadiiKm(460)).toEqual([150, 300, 460]);
  });
});

describe('placeLabels', () => {
  const box = (key: string, x: number, y: number) => ({ key, x, y, w: 100, h: 20 });

  it('places every candidate when none overlap', () => {
    const out = placeLabels([box('a', 0, 0), box('b', 0, 100), box('c', 0, 200)]);
    expect([...out.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('drops an overlapping candidate and keeps the higher-priority one', () => {
    const out = placeLabels([box('near', 0, 0), box('far', 10, 5)]);
    expect(out.has('near')).toBe(true);
    expect(out.has('far')).toBe(false);
  });

  it('keeps a later candidate that clears everything already placed', () => {
    const out = placeLabels([box('a', 0, 0), box('b', 10, 5), box('c', 0, 400)]);
    expect([...out.keys()]).toEqual(['a', 'c']);
  });

  it('treats touching edges as non-overlapping', () => {
    const out = placeLabels([box('a', 0, 0), box('b', 100, 0)]);
    expect(out.size).toBe(2);
  });

  it('returns the candidate position unchanged', () => {
    const out = placeLabels([box('a', 12, 34)]);
    expect(out.get('a')).toEqual({ x: 12, y: 34 });
  });

  it('handles an empty list', () => {
    expect(placeLabels([]).size).toBe(0);
  });
});
