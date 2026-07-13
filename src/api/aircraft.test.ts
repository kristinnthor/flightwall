import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AircraftInfo } from './aircraft';

const ADSBDB_OK = JSON.stringify({
  response: { aircraft: { registration: '9H-MAC', registered_owner: 'Comlux Malta Ltd' } },
});
const ADSBDB_UNKNOWN = '{"response":"unknown aircraft"}';
const HEXDB_OK = '{"ModeS":"4D2162","Registration":"9H-MAC","RegisteredOwners":"Comlux Malta"}';

describe('AircraftInfo.getOperator', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('returns the adsbdb registered owner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ADSBDB_OK, { status: 200 })));
    expect(await new AircraftInfo(localStorage, 'https://a/v0', 'https://h/api/v1').getOperator('4d2162'))
      .toBe('Comlux Malta Ltd');
  });

  it('falls back to hexdb when adsbdb does not know the aircraft', async () => {
    const f = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/aircraft/') && String(url).startsWith('https://a')
        ? new Response(ADSBDB_UNKNOWN, { status: 404 })
        : new Response(HEXDB_OK, { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await new AircraftInfo(localStorage, 'https://a/v0', 'https://h/api/v1').getOperator('4d2162'))
      .toBe('Comlux Malta');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('caches results: second call does not fetch', async () => {
    const f = vi.fn(async () => new Response(ADSBDB_OK, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const c = new AircraftInfo(localStorage, 'https://a/v0', 'https://h/api/v1');
    await c.getOperator('4d2162');
    await c.getOperator('4d2162');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('unknown everywhere is a cached definitive null', async () => {
    const f = vi.fn(async (url: RequestInfo | URL) =>
      String(url).startsWith('https://a')
        ? new Response(ADSBDB_UNKNOWN, { status: 404 })
        : new Response('{"status":"404"}', { status: 404 }));
    vi.stubGlobal('fetch', f);
    const c = new AircraftInfo(localStorage, 'https://a/v0', 'https://h/api/v1');
    expect(await c.getOperator('badhex')).toBeNull();
    expect(await c.getOperator('badhex')).toBeNull();
    expect(f).toHaveBeenCalledTimes(2); // both sources tried once, then cached
  });

  it('network failure is transient undefined, not cached', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', f);
    const c = new AircraftInfo(localStorage, 'https://a/v0', 'https://h/api/v1');
    expect(await c.getOperator('4d2162')).toBeUndefined();
    expect(await c.getOperator('4d2162')).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('non-ICAO ~hex resolves null without fetching', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await new AircraftInfo(localStorage, 'https://a/v0', 'https://h/api/v1').getOperator('~2f00a1')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
