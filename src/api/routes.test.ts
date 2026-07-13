import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AdsbdbRoutes } from './routes';

const OK_BODY = {
  response: {
    flightroute: {
      callsign: 'ICE615',
      airline: { name: 'Icelandair', icao: 'ICE', iata: 'FI' },
      origin: { iata_code: 'KEF', icao_code: 'BIKF', municipality: 'Reykjavík', latitude: 63.985, longitude: -22.6056 },
      destination: { iata_code: 'JFK', icao_code: 'KJFK', municipality: 'New York', latitude: 40.6398, longitude: -73.7789 },
    },
  },
};

describe('AdsbdbRoutes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('maps a route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(OK_BODY), { status: 200 })));
    const r = await new AdsbdbRoutes(localStorage, 'https://x/v0').getRoute('ICE615');
    expect(r).toEqual({
      airlineName: 'Icelandair',
      originCode: 'KEF', originCity: 'Reykjavík', originLat: 63.985, originLon: -22.6056,
      destCode: 'JFK', destCity: 'New York', destLat: 40.6398, destLon: -73.7789,
    });
  });

  it('caches: second call does not fetch', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(OK_BODY), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const client = new AdsbdbRoutes(localStorage, 'https://x/v0');
    await client.getRoute('ICE615');
    await client.getRoute('ICE615');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('negative-caches 404/unknown', async () => {
    const f = vi.fn(async () => new Response('{"response":"unknown callsign"}', { status: 404 }));
    vi.stubGlobal('fetch', f);
    const client = new AdsbdbRoutes(localStorage, 'https://x/v0');
    expect(await client.getRoute('NOPE1')).toBeNull();
    expect(await client.getRoute('NOPE1')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns undefined on network error without caching the failure', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', f);
    const client = new AdsbdbRoutes(localStorage, 'https://x/v0');
    expect(await client.getRoute('ICE615')).toBeUndefined();
    expect(await client.getRoute('ICE615')).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2); // transient errors are retryable
  });

  it('falls back to ICAO codes when IATA missing', async () => {
    const body = JSON.parse(JSON.stringify(OK_BODY));
    delete body.response.flightroute.origin.iata_code;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const r = await new AdsbdbRoutes(localStorage, 'https://x/v0').getRoute('ICE615');
    expect(r?.originCode).toBe('BIKF');
  });
});
