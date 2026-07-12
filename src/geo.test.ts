import { describe, it, expect } from 'vitest';
import { haversineKm, initialBearingDeg } from './geo';

describe('haversineKm', () => {
  it('zero for same point', () => expect(haversineKm(64, -21, 64, -21)).toBe(0));
  it('KEF to RVK is ~36 km', () => {
    expect(haversineKm(63.985, -22.6056, 64.13, -21.9406)).toBeGreaterThan(34);
    expect(haversineKm(63.985, -22.6056, 64.13, -21.9406)).toBeLessThan(38);
  });
});

describe('initialBearingDeg', () => {
  it('due north is 0', () => expect(initialBearingDeg(60, 10, 61, 10)).toBeCloseTo(0, 0));
  it('due east is ~90', () => expect(initialBearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 0));
  it('result is 0..360', () => {
    const b = initialBearingDeg(60, 10, 59, 9);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});
