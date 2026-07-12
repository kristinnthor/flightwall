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
