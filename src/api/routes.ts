import type { Route } from '../types';
import { TtlCache } from './cache';

interface AdsbdbAirport {
  iata_code?: string;
  icao_code?: string;
  municipality?: string;
  latitude?: number;
  longitude?: number;
}

interface AdsbdbBody {
  response?: {
    flightroute?: {
      airline?: { name?: string };
      origin?: AdsbdbAirport;
      destination?: AdsbdbAirport;
    };
  } | string;
}

const TTL_MS = 24 * 60 * 60 * 1000;

export class AdsbdbRoutes {
  private cache: TtlCache<Route>;
  private tail: Promise<unknown> = Promise.resolve(); // serialize requests

  constructor(
    storage: Storage | null,
    private baseUrl = 'https://api.adsbdb.com/v0',
    now: () => number = Date.now,
    private timeoutMs = 10_000,
  ) {
    this.cache = new TtlCache<Route>('flightwall.routes.v1', storage, TTL_MS, 500, now);
  }

  getRoute(callsign: string): Promise<Route | null | undefined> {
    const cached = this.cache.get(callsign);
    if (cached !== undefined) return Promise.resolve(cached);
    const result = this.tail.then(() => this.fetchRoute(callsign));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async fetchRoute(callsign: string): Promise<Route | null | undefined> {
    const cached = this.cache.get(callsign); // may have filled while queued
    if (cached !== undefined) return cached;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/callsign/${encodeURIComponent(callsign)}`, {
        signal: controller.signal,
      });
      if (res.status === 404) {
        this.cache.set(callsign, null);
        return null;
      }
      if (!res.ok) return undefined; // transient — do not cache
      const body: AdsbdbBody = await res.json();
      const fr = typeof body.response === 'object' ? body.response?.flightroute : undefined;
      if (!fr) {
        this.cache.set(callsign, null);
        return null;
      }
      const route: Route = {
        airlineName: fr.airline?.name ?? null,
        originCode: fr.origin?.iata_code ?? fr.origin?.icao_code ?? null,
        originCity: fr.origin?.municipality ?? null,
        originLat: fr.origin?.latitude ?? null,
        originLon: fr.origin?.longitude ?? null,
        destCode: fr.destination?.iata_code ?? fr.destination?.icao_code ?? null,
        destCity: fr.destination?.municipality ?? null,
        destLat: fr.destination?.latitude ?? null,
        destLon: fr.destination?.longitude ?? null,
      };
      this.cache.set(callsign, route);
      return route;
    } catch {
      return undefined; // network error / abort — transient, not cached
    } finally {
      clearTimeout(timer);
    }
  }
}
