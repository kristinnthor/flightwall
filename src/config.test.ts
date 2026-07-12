import { describe, it, expect, beforeEach } from 'vitest';
import { parseHash, serializeToHash, isValidConfig, loadConfig } from './config';

describe('parseHash', () => {
  it('parses a full hash', () => {
    expect(parseHash('#lat=64.14&lon=-21.94&r=50&label=HOME')).toEqual({
      lat: 64.14, lon: -21.94, radiusKm: 50, label: 'HOME',
    });
  });
  it('parses without label', () => {
    expect(parseHash('#lat=51.5&lon=0&r=30')).toEqual({ lat: 51.5, lon: 0, radiusKm: 30 });
  });
  it.each([
    ['', null], ['#', null],
    ['#lat=64&lon=-21', null],                 // missing r
    ['#r=50', null],                           // missing lat and lon
    ['#lon=10&r=50', null],                    // missing lat
    ['#lat=64&r=50', null],                    // missing lon
    ['#lat=abc&lon=-21&r=50', null],           // NaN
    ['#lat=91&lon=0&r=50', null],              // lat out of range
    ['#lat=0&lon=181&r=50', null],             // lon out of range
    ['#lat=0&lon=0&r=0', null],                // r below 1
    ['#lat=0&lon=0&r=461', null],              // r above 460
  ])('rejects %s', (hash, expected) => {
    expect(parseHash(hash)).toBe(expected);
  });
});

describe('serializeToHash', () => {
  it('round-trips', () => {
    const cfg = { lat: 64.14, lon: -21.94, radiusKm: 50, label: 'HOME KEF' };
    expect(parseHash(serializeToHash(cfg))).toEqual(cfg);
  });
  it('omits empty label', () => {
    expect(serializeToHash({ lat: 1, lon: 2, radiusKm: 3 })).toBe('#lat=1&lon=2&r=3');
  });
});

describe('loadConfig', () => {
  beforeEach(() => localStorage.clear());
  it('prefers hash and persists it', () => {
    const cfg = loadConfig('#lat=64&lon=-21&r=50', localStorage);
    expect(cfg).toEqual({ lat: 64, lon: -21, radiusKm: 50 });
    expect(loadConfig('', localStorage)).toEqual({ lat: 64, lon: -21, radiusKm: 50 });
  });
  it('returns null with no hash and no storage', () => {
    expect(loadConfig('', localStorage)).toBeNull();
  });
  it('ignores corrupt storage', () => {
    localStorage.setItem('flightwall.config', '{not json');
    expect(loadConfig('', localStorage)).toBeNull();
  });
});
