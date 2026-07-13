import { TtlCache } from './cache';

export interface RoutePair {
  originIcao: string;
  destIcao: string;
}

export interface Airport {
  icao: string;
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ICAO_RE = /^[A-Z0-9]{4}$/;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** hexdb.io callsign → "AAAA-BBBB" route pairs. Secondary route source, gated
 *  by the corridor plausibility check downstream. */
export class HexdbRoutes {
  private cache: TtlCache<RoutePair>;

  constructor(
    storage: Storage | null,
    private baseUrl = 'https://hexdb.io/api/v1',
    now: () => number = Date.now,
    private timeoutMs = 10_000,
  ) {
    this.cache = new TtlCache<RoutePair>('flightwall.hexroutes.v1', storage, DAY_MS, 300, now);
  }

  async getRoutePair(callsign: string): Promise<RoutePair | null | undefined> {
    const cached = this.cache.get(callsign);
    if (cached !== undefined) return cached;
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/route/icao/${encodeURIComponent(callsign)}`, this.timeoutMs);
      if (res.status === 404) {
        this.cache.set(callsign, null);
        return null;
      }
      if (!res.ok) return undefined;
      const body: { route?: string } = await res.json();
      const legs = (body.route ?? '').split('-').map((s) => s.trim().toUpperCase());
      const origin = legs[0];
      const dest = legs[legs.length - 1];
      if (legs.length < 2 || !origin || !dest || !ICAO_RE.test(origin) || !ICAO_RE.test(dest)) {
        this.cache.set(callsign, null);
        return null;
      }
      const pair: RoutePair = { originIcao: origin, destIcao: dest };
      this.cache.set(callsign, pair);
      return pair;
    } catch {
      return undefined;
    }
  }
}

/** hexdb.io airport lookups — tiny cardinality, cached long. */
export class HexdbAirports {
  private cache: TtlCache<Airport>;

  constructor(
    storage: Storage | null,
    private baseUrl = 'https://hexdb.io/api/v1',
    now: () => number = Date.now,
    private timeoutMs = 10_000,
  ) {
    this.cache = new TtlCache<Airport>('flightwall.airports.v1', storage, 30 * DAY_MS, 300, now);
  }

  async getAirport(icao: string): Promise<Airport | null | undefined> {
    const cached = this.cache.get(icao);
    if (cached !== undefined) return cached;
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/airport/icao/${encodeURIComponent(icao)}`, this.timeoutMs);
      if (res.status === 404) {
        this.cache.set(icao, null);
        return null;
      }
      if (!res.ok) return undefined;
      const body: { iata?: string; airport?: string; latitude?: number; longitude?: number } =
        await res.json();
      if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
        this.cache.set(icao, null); // unusable for plausibility checks
        return null;
      }
      const iataRaw = (body.iata ?? '').trim();
      const airport: Airport = {
        icao,
        iata: iataRaw && iataRaw !== '\\N' ? iataRaw : null,
        name: body.airport ?? icao,
        lat: body.latitude,
        lon: body.longitude,
      };
      this.cache.set(icao, airport);
      return airport;
    } catch {
      return undefined;
    }
  }
}
