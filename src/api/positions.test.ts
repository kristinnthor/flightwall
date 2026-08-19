import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeAircraft, buildPointUrl, PointFeedProvider, aircraftArrayOf,
  FailoverProvider, DEFAULT_API_BASES, sourceLabel,
} from './positions';
import type { Aircraft } from '../types';

const CENTER = { lat: 64.13, lon: -21.94 };

const AIRBORNE = {
  hex: '4cc2b5', type: 'adsb_icao', flight: 'ICE615  ', r: 'TF-ICY', t: 'B39M',
  alt_baro: 34000, gs: 450.3, baro_rate: -64, lat: 64.5, lon: -22.1,
  dst: 12.5, dir: 271.4, seen: 0.2,
};

describe('normalizeAircraft', () => {
  it('normalizes an airborne aircraft', () => {
    expect(normalizeAircraft(AIRBORNE, CENTER)).toEqual({
      hex: '4cc2b5', callsign: 'ICE615', registration: 'TF-ICY', typeCode: 'B39M',
      altitudeFt: 34000, groundSpeedKt: 450.3, verticalRateFpm: -64,
      distanceKm: 12.5 * 1.852, bearingDeg: 271.4, track: null, lat: 64.5, lon: -22.1,
    });
  });
  // track is the aircraft's own heading; bearingDeg is the bearing from home.
  // The map view needs the former and must not substitute the latter.
  it('carries the reported track through', () => {
    expect(normalizeAircraft({ ...AIRBORNE, track: 88.5 }, CENTER)?.track).toBe(88.5);
  });
  it('leaves track null when the feed omits it', () => {
    expect(normalizeAircraft(AIRBORNE, CENTER)?.track).toBeNull();
  });
  it('keeps track independent of bearingDeg', () => {
    const a = normalizeAircraft({ ...AIRBORNE, track: 10, dir: 271.4 }, CENTER)!;
    expect(a.track).toBe(10);
    expect(a.bearingDeg).toBe(271.4);
  });
  it('excludes ground targets', () => {
    expect(normalizeAircraft({ ...AIRBORNE, alt_baro: 'ground' }, CENTER)).toBeNull();
  });
  it('excludes mode_s (no position)', () => {
    expect(normalizeAircraft({ ...AIRBORNE, type: 'mode_s' }, CENTER)).toBeNull();
  });
  it('excludes missing lat/lon', () => {
    const { lat: _lat, ...rest } = AIRBORNE;
    expect(normalizeAircraft(rest, CENTER)).toBeNull();
  });
  it('falls back to alt_geom when alt_baro missing', () => {
    const { alt_baro: _ab, ...rest } = AIRBORNE;
    expect(normalizeAircraft({ ...rest, alt_geom: 33500 }, CENTER)?.altitudeFt).toBe(33500);
  });
  it('excludes when no altitude at all', () => {
    const { alt_baro: _ab, ...rest } = AIRBORNE;
    expect(normalizeAircraft(rest, CENTER)).toBeNull();
  });
  it('computes distance/bearing from center when dst/dir missing', () => {
    const { dst: _d, dir: _b, ...rest } = AIRBORNE;
    const a = normalizeAircraft(rest, CENTER);
    expect(a?.distanceKm).toBeGreaterThan(40);
    expect(a?.distanceKm).toBeLessThan(45);
    expect(a?.bearingDeg).toBeGreaterThanOrEqual(0);
  });
  it('keeps TIS-B ~hex with missing r/t as nulls', () => {
    const a = normalizeAircraft(
      { hex: '~2f00a1', type: 'tisb_other', alt_baro: 3000, lat: 64.2, lon: -21.9, dst: 5, dir: 10 },
      CENTER,
    );
    expect(a).toMatchObject({ hex: '~2f00a1', callsign: null, registration: null, typeCode: null });
  });
});

describe('buildPointUrl', () => {
  it('converts km to nm, rounded up', () => {
    expect(buildPointUrl('https://x/v2', 64.13, -21.94, 50))
      .toBe('https://x/v2/point/64.13/-21.94/27'); // 50/1.852 = 26.998 -> ceil -> 27
  });
  it('caps at 250 nm and floors at 1', () => {
    expect(buildPointUrl('https://x/v2', 0, 0, 500)).toBe('https://x/v2/point/0/0/250');
    expect(buildPointUrl('https://x/v2', 0, 0, 0)).toBe('https://x/v2/point/0/0/1');
  });
});

describe('PointFeedProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches, normalizes, filters', async () => {
    const body = { ac: [AIRBORNE, { ...AIRBORNE, hex: 'aaa', alt_baro: 'ground' }], total: 2 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const list = await new PointFeedProvider('https://x/v2').fetchAircraft(64.13, -21.94, 50);
    expect(list).toHaveLength(1);
    expect(list[0]?.hex).toBe('4cc2b5');
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    await expect(new PointFeedProvider('https://x/v2').fetchAircraft(0, 0, 10))
      .rejects.toThrow('429');
  });

  it('tolerates missing ac array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"msg":"No error"}', { status: 200 })));
    await expect(new PointFeedProvider('https://x/v2').fetchAircraft(0, 0, 10)).resolves.toEqual([]);
  });
});

describe('sourceLabel', () => {
  it('names the host, without the api prefix', () => {
    expect(sourceLabel('https://api.airplanes.live/v2')).toBe('AIRPLANES.LIVE');
    expect(sourceLabel('https://api.adsb.fi/v2')).toBe('ADSB.FI');
    expect(sourceLabel('https://adsb.one/v2')).toBe('ADSB.ONE');
  });
});

// airplanes.live began answering browser requests with a CORS-less 403, which
// took the whole wall down. One hardcoded source is a single point of failure.
describe('FailoverProvider', () => {
  const one = (hex: string): Aircraft => ({
    hex, callsign: null, registration: null, typeCode: null, altitudeFt: 30000,
    groundSpeedKt: null, verticalRateFpm: null, distanceKm: 1, bearingDeg: 0,
    track: null, lat: 64, lon: -21,
  });

  /** Fake provider factory: each base either answers or throws, and every call
   *  is recorded so ordering and stickiness are observable. */
  function fake(behaviour: Record<string, 'ok' | 'fail'>) {
    const calls: string[] = [];
    const make = (base: string) => ({
      fetchAircraft: async () => {
        calls.push(base);
        if (behaviour[base] === 'ok') return [one(base)];
        throw new Error(`${base} refused`);
      },
    });
    return { make, calls };
  }

  const A = 'https://a/v2', B = 'https://b/v2', C = 'https://c/v2';

  it('uses the first source when it works, and tries no others', async () => {
    const { make, calls } = fake({ [A]: 'ok', [B]: 'ok', [C]: 'ok' });
    const p = new FailoverProvider([A, B, C], make);
    expect(await p.fetchAircraft(64, -21, 50)).toHaveLength(1);
    expect(calls).toEqual([A]);
    expect(p.activeBase).toBe(A);
  });

  it('falls through to the next source when the first refuses', async () => {
    const { make, calls } = fake({ [A]: 'fail', [B]: 'ok', [C]: 'ok' });
    const p = new FailoverProvider([A, B, C], make);
    const list = await p.fetchAircraft(64, -21, 50);
    expect(list[0]!.hex).toBe(B);
    expect(calls).toEqual([A, B]);
  });

  it('sticks to the working source instead of retrying the dead one', async () => {
    const { make, calls } = fake({ [A]: 'fail', [B]: 'ok', [C]: 'ok' });
    const p = new FailoverProvider([A, B, C], make);
    await p.fetchAircraft(64, -21, 50);
    calls.length = 0;
    await p.fetchAircraft(64, -21, 50);
    expect(calls).toEqual([B]); // A is not retried on every poll
    expect(p.activeBase).toBe(B);
  });

  it('wraps around to earlier sources when the active one dies', async () => {
    const behaviour: Record<string, 'ok' | 'fail'> = { [A]: 'fail', [B]: 'ok', [C]: 'fail' };
    const { make } = fake(behaviour);
    const p = new FailoverProvider([A, B, C], make);
    await p.fetchAircraft(64, -21, 50);
    expect(p.activeBase).toBe(B);
    behaviour[B] = 'fail';
    behaviour[A] = 'ok';
    const list = await p.fetchAircraft(64, -21, 50);
    expect(list[0]!.hex).toBe(A);
    expect(p.activeBase).toBe(A);
  });

  // PollLoop's backoff and the board's stale/lost states depend on this.
  it('throws when every source fails', async () => {
    const { make, calls } = fake({ [A]: 'fail', [B]: 'fail', [C]: 'fail' });
    const p = new FailoverProvider([A, B, C], make);
    await expect(p.fetchAircraft(64, -21, 50)).rejects.toThrow(/refused/);
    expect(calls).toEqual([A, B, C]);
  });

  it('rejects an empty source list rather than failing silently later', () => {
    expect(() => new FailoverProvider([])).toThrow();
  });

  it('ships airplanes.live first, with alternates behind it', () => {
    expect(DEFAULT_API_BASES[0]).toContain('airplanes.live');
    expect(DEFAULT_API_BASES.length).toBeGreaterThan(1);
    for (const b of DEFAULT_API_BASES) expect(b.startsWith('https://')).toBe(true);
  });
});

// adsb.fi answered 404, not 403 - the host was fine, the URL shape was not.
// Feeds do not share one path layout, so the template has to express it.
describe('buildPointUrl templates', () => {
  it('keeps the point-style shape for a bare base URL', () => {
    expect(buildPointUrl('https://api.airplanes.live/v2', 64.1, -21.9, 50))
      .toBe('https://api.airplanes.live/v2/point/64.1/-21.9/27');
  });

  it('fills lat/lon/nm placeholders for feeds with another layout', () => {
    expect(buildPointUrl('https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}', 64.1, -21.9, 50))
      .toBe('https://opendata.adsb.fi/api/v3/lat/64.1/lon/-21.9/dist/27');
  });

  it('clamps the radius to the 250 NM every feed caps at', () => {
    expect(buildPointUrl('https://x/{lat}/{lon}/{nm}', 0, 0, 100000)).toBe('https://x/0/0/250');
    expect(buildPointUrl('https://x/{lat}/{lon}/{nm}', 0, 0, 0.1)).toBe('https://x/0/0/1');
  });
});

describe('aircraftArrayOf', () => {
  it('reads the v2 "ac" key', () => {
    expect(aircraftArrayOf({ ac: [{ hex: 'a' }] })).toHaveLength(1);
  });

  // The v3 shape names it differently; accepting both means a feed can be
  // added without knowing which generation it serves.
  it('reads the v3 "aircraft" key', () => {
    expect(aircraftArrayOf({ aircraft: [{ hex: 'a' }, { hex: 'b' }] })).toHaveLength(2);
  });

  it('prefers ac when a response somehow carries both', () => {
    expect(aircraftArrayOf({ ac: [{ hex: 'a' }], aircraft: [] })).toHaveLength(1);
  });

  it('returns empty for anything unusable rather than throwing', () => {
    for (const body of [null, undefined, 42, 'nope', {}, { ac: 'no' }, { total: 3 }]) {
      expect(aircraftArrayOf(body)).toEqual([]);
    }
  });
});

describe('default feed list', () => {
  it('lists airplanes.live first and adsb.fi on its documented host and path', () => {
    expect(DEFAULT_API_BASES[0]).toContain('airplanes.live');
    const fi = DEFAULT_API_BASES.filter((b) => b.includes('adsb.fi'));
    expect(fi.length).toBeGreaterThan(0);
    for (const b of fi) {
      expect(b).toContain('opendata.adsb.fi/api'); // not api.adsb.fi, which 404s
      expect(b).toContain('/lat/{lat}/lon/{lon}/dist/{nm}');
    }
  });

  it('labels sources by network, not by hostname prefix', () => {
    expect(sourceLabel('https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}')).toBe('ADSB.FI');
  });
});

// A proxy sits at its own hostname, but the credit belongs to the network
// behind it — crediting "something.workers.dev" credits nobody.
describe('upstream attribution', () => {
  const A = 'https://proxy.example/v2/lat/{lat}/lon/{lon}/dist/{nm}';

  function providerWith(upstreamLabel: string | null) {
    return {
      upstreamLabel,
      fetchAircraft: async () => [],
    };
  }

  it('credits the network a proxy names, not the proxy host', async () => {
    const p = new FailoverProvider([A], () => providerWith('ADSB.FI'));
    await p.fetchAircraft(64, -21, 50);
    expect(p.activeLabel).toBe('ADSB.FI');
  });

  it('falls back to the host when nothing declares an upstream', async () => {
    const p = new FailoverProvider([A], () => providerWith(null));
    await p.fetchAircraft(64, -21, 50);
    expect(p.activeLabel).toBe('PROXY.EXAMPLE');
  });

  it('drops a stale upstream when a later source declares none', async () => {
    let label: string | null = 'ADSB.FI';
    const p = new FailoverProvider([A], () => providerWith(label));
    await p.fetchAircraft(64, -21, 50);
    expect(p.activeLabel).toBe('ADSB.FI');
    label = null;
    await p.fetchAircraft(64, -21, 50);
    expect(p.activeLabel).toBe('PROXY.EXAMPLE');
  });
});

