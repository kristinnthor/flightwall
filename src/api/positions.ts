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

export function buildPointUrl(base: string, lat: number, lon: number, radiusKm: number): string {
  const nm = Math.min(250, Math.max(1, Math.ceil(radiusKm / NM_TO_KM)));
  return `${base}/point/${lat}/${lon}/${nm}`;
}

export class AirplanesLiveProvider implements AircraftProvider {
  constructor(
    private baseUrl = 'https://api.airplanes.live/v2',
    private timeoutMs = 10_000,
  ) {}

  async fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(buildPointUrl(this.baseUrl, lat, lon, radiusKm), {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`positions HTTP ${res.status}`);
      const body: { ac?: RawV2Aircraft[] } = await res.json();
      const center = { lat, lon };
      const out: Aircraft[] = [];
      for (const raw of body.ac ?? []) {
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
  'https://api.airplanes.live/v2',
  'https://api.adsb.fi/v2',
  'https://api.adsb.one/v2',
];

/** Host of a base URL, upper-cased for the attribution line. */
export function sourceLabel(base: string): string {
  const m = /^https:\/\/([^/]+)/.exec(base);
  return (m ? m[1]! : base).replace(/^api\./, '').toUpperCase();
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

  constructor(
    private bases: string[] = DEFAULT_API_BASES,
    private make: (base: string) => AircraftProvider = (base) => new AirplanesLiveProvider(base),
  ) {
    if (bases.length === 0) throw new Error('FailoverProvider needs at least one base URL');
  }

  /** Base URL currently serving data — drives the attribution line. */
  get activeBase(): string {
    return this.bases[this.active]!;
  }

  async fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]> {
    let lastError: unknown = new Error('no sources tried');
    for (let i = 0; i < this.bases.length; i++) {
      const index = (this.active + i) % this.bases.length;
      try {
        const list = await this.make(this.bases[index]!).fetchAircraft(lat, lon, radiusKm);
        this.active = index; // stick to whatever answered
        return list;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}
