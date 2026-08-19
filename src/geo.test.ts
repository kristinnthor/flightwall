import { describe, it, expect } from 'vitest';
import { haversineKm, initialBearingDeg, projectLocalKm } from './geo';

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

describe('projectLocalKm', () => {
  it('origin projects to zero', () => {
    const p = projectLocalKm(64, -21, 64, -21);
    expect(p.xKm).toBeCloseTo(0, 9);
    expect(p.yKm).toBeCloseTo(0, 9);
  });

  it('1 degree of latitude north is ~111 km, with no east component', () => {
    const p = projectLocalKm(64, -21, 65, -21);
    expect(p.yKm).toBeCloseTo(111.19, 1);
    expect(p.xKm).toBeCloseTo(0, 9);
  });

  it('1 degree of longitude at 64N is ~48.7 km', () => {
    const p = projectLocalKm(64, -21, 64, -20);
    expect(p.xKm).toBeCloseTo(48.75, 1);
    expect(p.yKm).toBeCloseTo(0, 9);
  });

  it('south and west are negative', () => {
    const p = projectLocalKm(64, -21, 63, -22);
    expect(p.xKm).toBeLessThan(0);
    expect(p.yKm).toBeLessThan(0);
  });

  // The scope draws range rings from these coordinates, so radial distance has
  // to agree with the haversine the board already displays.
  it('radial distance tracks haversineKm within 0.5% out to the config ceiling', () => {
    const cases: [number, number][] = [
      [66, -16], [60, -30], [64, -10], [68, -21], [62, -21], [64, -33],
    ];
    for (const [lat, lon] of cases) {
      const p = projectLocalKm(64, -21, lat, lon);
      const approx = Math.hypot(p.xKm, p.yKm);
      const exact = haversineKm(64, -21, lat, lon);
      expect(Math.abs(approx - exact) / exact).toBeLessThan(0.005);
    }
  });

  it('projects across the antimeridian the short way', () => {
    const p = projectLocalKm(0, 179, 0, -179);
    expect(p.xKm).toBeGreaterThan(200);
    expect(p.xKm).toBeLessThan(240);
  });
});
