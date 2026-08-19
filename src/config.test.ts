import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseHash, serializeToHash, isValidConfig, loadConfig, clearStoredConfig,
  trailWindowMs, DEFAULT_TRAIL_MINUTES, VIEW_KEY,
} from './config';

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

describe('clearStoredConfig', () => {
  beforeEach(() => localStorage.clear());
  it('removes config and cache keys but leaves unrelated keys', () => {
    localStorage.setItem('flightwall.config', '{"lat":1}');
    localStorage.setItem('flightwall.routes.v1', '{}');
    localStorage.setItem('flightwall.photos.v1', '{}');
    localStorage.setItem('unrelated', 'keep');
    clearStoredConfig(localStorage);
    expect(localStorage.getItem('flightwall.config')).toBeNull();
    expect(localStorage.getItem('flightwall.routes.v1')).toBeNull();
    expect(localStorage.getItem('flightwall.photos.v1')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});

describe('trailMinutes', () => {
  const base = '#lat=64&lon=-21&r=50';

  it('reads t from the hash', () => {
    expect(parseHash(`${base}&t=120`)?.trailMinutes).toBe(120);
  });

  it('accepts 0, meaning positions with no trail', () => {
    expect(parseHash(`${base}&t=0`)?.trailMinutes).toBe(0);
  });

  // The regression that matters: every config saved before the map view
  // existed has no t, and must still load straight to the board.
  it('is optional — a config without t stays valid', () => {
    const cfg = parseHash(base);
    expect(cfg).not.toBeNull();
    expect(cfg?.trailMinutes).toBeUndefined();
    expect(isValidConfig({ lat: 64, lon: -21, radiusKm: 50 })).toBe(true);
  });

  it('defaults to 60 minutes when unset', () => {
    expect(trailWindowMs({ lat: 64, lon: -21, radiusKm: 50 })).toBe(60 * 60_000);
    expect(DEFAULT_TRAIL_MINUTES).toBe(60);
  });

  it('honours an explicit window, including zero', () => {
    expect(trailWindowMs({ lat: 64, lon: -21, radiusKm: 50, trailMinutes: 90 })).toBe(90 * 60_000);
    expect(trailWindowMs({ lat: 64, lon: -21, radiusKm: 50, trailMinutes: 0 })).toBe(0);
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(parseHash(`${base}&t=-1`)).toBeNull();
    expect(parseHash(`${base}&t=181`)).toBeNull();
    expect(parseHash(`${base}&t=abc`)).toBeNull();
  });

  it('round-trips through serializeToHash', () => {
    const cfg = { lat: 64, lon: -21, radiusKm: 50, trailMinutes: 25 };
    expect(parseHash(serializeToHash(cfg))).toEqual(cfg);
    const zero = { lat: 64, lon: -21, radiusKm: 50, trailMinutes: 0 };
    expect(parseHash(serializeToHash(zero))).toEqual(zero);
  });

  it('omits t from the hash when unset', () => {
    // Parsed, not substring-matched: "lat=64" contains "t=".
    const hash = serializeToHash({ lat: 64, lon: -21, radiusKm: 50 });
    expect(new URLSearchParams(hash.slice(1)).has('t')).toBe(false);
  });
});

describe('clearStoredConfig', () => {
  it('clears the saved view preference too', () => {
    localStorage.setItem(VIEW_KEY, 'map');
    clearStoredConfig(localStorage);
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });
});

// Number('') and Number(' ') are both 0, and 0 is a valid latitude and a valid
// "no trail" — so a blank value must read as missing, not as a deliberate zero.
describe('blank and whitespace hash parameters', () => {
  it('treats a whitespace trail window as unset, not as zero', () => {
    const cfg = parseHash('#lat=64&lon=-21&r=50&t=%20');
    expect(cfg).not.toBeNull();
    expect(cfg?.trailMinutes).toBeUndefined();
    expect(trailWindowMs(cfg!)).toBe(DEFAULT_TRAIL_MINUTES * 60_000);
  });

  it('treats an empty trail window as unset', () => {
    expect(parseHash('#lat=64&lon=-21&r=50&t=')?.trailMinutes).toBeUndefined();
  });

  it('tolerates surrounding whitespace on a real value', () => {
    expect(parseHash('#lat=64&lon=-21&r=50&t=%2015%20')?.trailMinutes).toBe(15);
    expect(parseHash('#lat=%2064%20&lon=-21&r=50')?.lat).toBe(64);
  });

  it('rejects a whitespace-only position instead of reading it as 0,0', () => {
    expect(parseHash('#lat=%20&lon=-21&r=50')).toBeNull();
    expect(parseHash('#lat=64&lon=%20&r=50')).toBeNull();
    expect(parseHash('#lat=64&lon=-21&r=%20')).toBeNull();
  });

  it('still accepts a genuine zero', () => {
    expect(parseHash('#lat=0&lon=0&r=50')?.lat).toBe(0);
    expect(parseHash('#lat=64&lon=-21&r=50&t=0')?.trailMinutes).toBe(0);
  });
});

describe('apiBase override', () => {
  const base = '#lat=64&lon=-21&r=50';

  it('reads api from the hash and strips a trailing slash', () => {
    expect(parseHash(`${base}&api=https%3A%2F%2Fapi.adsb.fi%2Fv2`)?.apiBase)
      .toBe('https://api.adsb.fi/v2');
    expect(parseHash(`${base}&api=https%3A%2F%2Fapi.adsb.fi%2Fv2%2F`)?.apiBase)
      .toBe('https://api.adsb.fi/v2');
  });

  it('is optional — configs without it stay valid and use the default list', () => {
    expect(parseHash(base)?.apiBase).toBeUndefined();
    expect(isValidConfig({ lat: 64, lon: -21, radiusKm: 50 })).toBe(true);
  });

  // Mixed content would be blocked on the https-only Pages deployment anyway.
  it('rejects a non-https source', () => {
    expect(parseHash(`${base}&api=http%3A%2F%2Fapi.adsb.fi%2Fv2`)).toBeNull();
    expect(parseHash(`${base}&api=ftp%3A%2F%2Fnope`)).toBeNull();
  });

  it('round-trips through serializeToHash', () => {
    const cfg = { lat: 64, lon: -21, radiusKm: 50, apiBase: 'https://api.adsb.fi/v2' };
    expect(parseHash(serializeToHash(cfg))).toEqual(cfg);
  });

  // Feeds do not share one URL layout, so a pinned source must be able to
  // carry placeholders through the hash intact.
  it('round-trips a templated source with placeholders', () => {
    const cfg = {
      lat: 64, lon: -21, radiusKm: 50,
      apiBase: 'https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}',
    };
    expect(parseHash(serializeToHash(cfg))).toEqual(cfg);
  });

  it('omits api from the hash when unset', () => {
    const hash = serializeToHash({ lat: 64, lon: -21, radiusKm: 50 });
    expect(new URLSearchParams(hash.slice(1)).has('api')).toBe(false);
  });
});

