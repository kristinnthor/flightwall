import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeAircraft, buildPointUrl, AirplanesLiveProvider } from './positions';

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
      distanceKm: 12.5 * 1.852, bearingDeg: 271.4, lat: 64.5, lon: -22.1,
    });
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

describe('AirplanesLiveProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches, normalizes, filters', async () => {
    const body = { ac: [AIRBORNE, { ...AIRBORNE, hex: 'aaa', alt_baro: 'ground' }], total: 2 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const list = await new AirplanesLiveProvider('https://x/v2').fetchAircraft(64.13, -21.94, 50);
    expect(list).toHaveLength(1);
    expect(list[0]?.hex).toBe('4cc2b5');
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    await expect(new AirplanesLiveProvider('https://x/v2').fetchAircraft(0, 0, 10))
      .rejects.toThrow('429');
  });

  it('tolerates missing ac array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"msg":"No error"}', { status: 200 })));
    await expect(new AirplanesLiveProvider('https://x/v2').fetchAircraft(0, 0, 10)).resolves.toEqual([]);
  });
});
