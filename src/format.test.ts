import { describe, it, expect } from 'vitest';
import {
  nmToKm, trimCallsign, formatDistanceKm, formatAlt, climbArrow, compass16, formatAgeSeconds,
} from './format';

it('nmToKm', () => expect(nmToKm(10)).toBeCloseTo(18.52));

describe('trimCallsign', () => {
  it('trims padded callsign', () => expect(trimCallsign('ICE615  ')).toBe('ICE615'));
  it('null for blank/undefined', () => {
    expect(trimCallsign('        ')).toBeNull();
    expect(trimCallsign(undefined)).toBeNull();
  });
});

describe('formatDistanceKm', () => {
  it('one decimal below 10', () => expect(formatDistanceKm(3.456)).toBe('3.5'));
  it('integer at 10+', () => expect(formatDistanceKm(21.37)).toBe('21'));
});

it('formatAlt groups thousands', () => expect(formatAlt(36000)).toBe('36,000'));

describe('climbArrow', () => {
  it.each([
    [1200, '↑'], [-800, '↓'], [200, ''], [null, ''], [-256, ''],
  ] as const)('%s -> %s', (fpm, arrow) => expect(climbArrow(fpm)).toBe(arrow));
});

describe('compass16', () => {
  it.each([
    [0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'],
    [337.5, 'NNW'], [349, 'N'], [360, 'N'], [22.4, 'NNE'],
  ] as const)('%s° -> %s', (deg, pt) => expect(compass16(deg)).toBe(pt));
});

it('formatAgeSeconds', () => expect(formatAgeSeconds(12_400)).toBe('+12s'));
