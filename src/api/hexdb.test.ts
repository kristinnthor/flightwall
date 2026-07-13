import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HexdbRoutes, HexdbAirports } from './hexdb';

describe('HexdbRoutes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('parses an ICAO pair', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"flight": "MLM712", "route": "LEGE-GMMN", "updatetime": 1747593022}', { status: 200 })));
    expect(await new HexdbRoutes(localStorage, 'https://x/api/v1').getRoutePair('MLM712'))
      .toEqual({ originIcao: 'LEGE', destIcao: 'GMMN' });
  });

  it('multi-leg routes use first and last airport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"flight": "X", "route": "BIKF-EGLL-LFPG"}', { status: 200 })));
    expect(await new HexdbRoutes(localStorage, 'https://x/api/v1').getRoutePair('X'))
      .toEqual({ originIcao: 'BIKF', destIcao: 'LFPG' });
  });

  it('404 is a cached definitive null', async () => {
    const f = vi.fn(async () => new Response('{"status":"404","error":"Route not found."}', { status: 404 }));
    vi.stubGlobal('fetch', f);
    const c = new HexdbRoutes(localStorage, 'https://x/api/v1');
    expect(await c.getRoutePair('NOPE1')).toBeNull();
    expect(await c.getRoutePair('NOPE1')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('malformed route string is definitive null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"flight": "X", "route": "unknown"}', { status: 200 })));
    expect(await new HexdbRoutes(localStorage, 'https://x/api/v1').getRoutePair('X')).toBeNull();
  });

  it('network error is transient undefined, not cached', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', f);
    const c = new HexdbRoutes(localStorage, 'https://x/api/v1');
    expect(await c.getRoutePair('MLM712')).toBeUndefined();
    expect(await c.getRoutePair('MLM712')).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('HexdbAirports', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  const KEF_BODY = '{"country_code": "IS", "region_name": "Sudurnes", "iata": "KEF", "icao": "BIKF", "airport": "Keflavík International Airport", "latitude": 63.985, "longitude": -22.6056}';

  it('maps an airport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(KEF_BODY, { status: 200 })));
    expect(await new HexdbAirports(localStorage, 'https://x/api/v1').getAirport('BIKF')).toEqual({
      icao: 'BIKF', iata: 'KEF', name: 'Keflavík International Airport', lat: 63.985, lon: -22.6056,
    });
  });

  it('caches airports', async () => {
    const f = vi.fn(async () => new Response(KEF_BODY, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const c = new HexdbAirports(localStorage, 'https://x/api/v1');
    await c.getAirport('BIKF');
    await c.getAirport('BIKF');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('placeholder IATA "\\\\N" becomes null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"iata": "\\\\N", "icao": "BIRK", "airport": "Reykjavik", "latitude": 64.13, "longitude": -21.94}', { status: 200 })));
    const a = await new HexdbAirports(localStorage, 'https://x/api/v1').getAirport('BIRK');
    expect(a?.iata).toBeNull();
  });

  it('missing coordinates is definitive null (unusable for plausibility)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"iata": "X", "icao": "XXXX", "airport": "X"}', { status: 200 })));
    expect(await new HexdbAirports(localStorage, 'https://x/api/v1').getAirport('XXXX')).toBeNull();
  });
});
