import type { Aircraft } from '../types';
import { NM_TO_KM, nmToKm, trimCallsign } from '../format';
import { haversineKm, initialBearingDeg } from '../geo';

/** Subset of the ADSBx-v2 per-aircraft JSON we consume. Every field optional by design. */
export interface RawV2Aircraft {
  hex?: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number; // true track over ground
  baro_rate?: number;
  lat?: number;
  lon?: number;
  dst?: number; // nm from query point (radius queries only)
  dir?: number; // bearing from query point
  seen?: number;
}

export interface AircraftProvider {
  fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]>;
  /** Network that actually supplied the data, when the endpoint declares one.
   *  A proxy sits at its own hostname but must credit the feed behind it. */
  readonly upstreamLabel?: string | null;
}

export function normalizeAircraft(
  raw: RawV2Aircraft,
  center: { lat: number; lon: number },
): Aircraft | null {
  if (!raw.hex) return null;
  if (raw.type === 'mode_s') return null;
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
  if (raw.alt_baro === 'ground') return null;

  const altitudeFt =
    typeof raw.alt_baro === 'number' ? raw.alt_baro
    : typeof raw.alt_geom === 'number' ? raw.alt_geom
    : null;
  if (altitudeFt === null) return null;

  const distanceKm =
    typeof raw.dst === 'number' ? nmToKm(raw.dst)
    : haversineKm(center.lat, center.lon, raw.lat, raw.lon);
  const bearingDeg =
    typeof raw.dir === 'number' ? raw.dir
    : initialBearingDeg(center.lat, center.lon, raw.lat, raw.lon);

  return {
    hex: raw.hex,
    callsign: trimCallsign(raw.flight),
    registration: raw.r ?? null,
    typeCode: raw.t ?? null,
    altitudeFt,
    groundSpeedKt: typeof raw.gs === 'number' ? raw.gs : null,
    verticalRateFpm: typeof raw.baro_rate === 'number' ? raw.baro_rate : null,
    distanceKm,
    bearingDeg,
    track: typeof raw.track === 'number' ? raw.track : null,
    lat: raw.lat,
    lon: raw.lon,
  };
}

/** Query radius in nautical miles, clamped to the 250 NM every feed caps at. */
export function radiusToNm(radiusKm: number): number {
  return Math.min(250, Math.max(1, Math.ceil(radiusKm / NM_TO_KM)));
}

/**
 * Build a request URL from a feed template.
 *
 * Feeds do NOT share one URL shape: airplanes.live uses
 * `/v2/point/{lat}/{lon}/{nm}` while adsb.fi uses
 * `/v3/lat/{lat}/lon/{lon}/dist/{nm}`. Assuming a single shape is what made
 * adsb.fi answer 404 rather than data. A template with {lat}/{lon}/{nm}
 * placeholders expresses any of them; a bare base URL keeps the original
 * point-style behaviour so existing api= links still work.
 */
export function buildPointUrl(
  template: string,
  lat: number,
  lon: number,
  radiusKm: number,
): string {
  const nm = radiusToNm(radiusKm);
  if (template.includes('{lat}')) {
    return template
      .replace('{lat}', String(lat))
      .replace('{lon}', String(lon))
      .replace('{nm}', String(nm));
  }
  return `${template}/point/${lat}/${lon}/${nm}`;
}

/**
 * The aircraft array, whatever the feed calls it. ADSBExchange-v2 responses use
 * `ac`; the v3 shape uses `aircraft`. Accepting both means a feed can be added
 * without knowing which generation it serves.
 */
export function aircraftArrayOf(body: unknown): RawV2Aircraft[] {
  if (typeof body !== 'object' || body === null) return [];
  const o = body as Record<string, unknown>;
  for (const key of ['ac', 'aircraft']) {
    if (Array.isArray(o[key])) return o[key] as RawV2Aircraft[];
  }
  return [];
}

/** One feed, addressed by URL template. Named for the query it makes, not for
 *  any particular network — several serve the same aircraft shape. */
export class PointFeedProvider implements AircraftProvider {
  upstreamLabel: string | null = null;

  constructor(
    private template = 'https://api.airplanes.live/v2',
    private timeoutMs = 10_000,
  ) {}

  async fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(buildPointUrl(this.template, lat, lon, radiusKm), {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`positions HTTP ${res.status}`);
      this.upstreamLabel = res.headers.get('X-Upstream-Source');
      const center = { lat, lon };
      const out: Aircraft[] = [];
      for (const raw of aircraftArrayOf(await res.json())) {
        const a = normalizeAircraft(raw, center);
        if (a) out.push(a);
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Feeds sharing the ADSBExchange-v2 response shape (`{ ac: [...] }`), tried in
 * order. airplanes.live stays first — it is the source this wall was built
 * against — but it began refusing browser requests with a CORS-less 403, so a
 * single hardcoded source is a single point of failure.
 */
export const DEFAULT_API_BASES = [
  // Kept first: the source this wall was built against, in case feeder-only
  // access is lifted. Currently answers browser requests with a 403.
  'https://api.airplanes.live/v2',
  // adsb.fi, per its published API reference: different host AND path shape.
  // v3 is the documented current endpoint; v2 still works but is deprecated
  // and returns a different format, so both are listed and the parser accepts
  // either aircraft-array key.
  'https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}',
  'https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}',
];

/** Host of a base URL, upper-cased for the attribution line. */
export function sourceLabel(base: string): string {
  const m = /^https:\/\/([^/]+)/.exec(base);
  return (m ? m[1]! : base).replace(/^(api|opendata)\./, '').toUpperCase();
}

/**
 * Tries each base URL in turn and sticks to the first that answers, so a source
 * going away costs one failed request rather than the whole wall. Re-probes
 * from the top once the current one starts failing.
 *
 * Throws when every source fails, so PollLoop's backoff and the board's
 * stale/lost states still behave exactly as before.
 */
export class FailoverProvider implements AircraftProvider {
  private active = 0;
  private upstream: string | null = null;

  constructor(
    private bases: string[] = DEFAULT_API_BASES,
    private make: (base: string) => AircraftProvider = (base) => new PointFeedProvider(base),
  ) {
    if (bases.length === 0) throw new Error('FailoverProvider needs at least one base URL');
  }

  /** Base URL currently serving data. */
  get activeBase(): string {
    return this.bases[this.active]!;
  }

  /** Who to credit: the network a proxy names, else the host being called. */
  get activeLabel(): string {
    return this.upstream ?? sourceLabel(this.activeBase);
  }

  async fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]> {
    let lastError: unknown = new Error('no sources tried');
    for (let i = 0; i < this.bases.length; i++) {
      const index = (this.active + i) % this.bases.length;
      try {
        const provider = this.make(this.bases[index]!);
        const list = await provider.fetchAircraft(lat, lon, radiusKm);
        this.active = index; // stick to whatever answered
        this.upstream = provider.upstreamLabel ?? null;
        return list;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}
