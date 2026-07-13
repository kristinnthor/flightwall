import { TtlCache } from './cache';

interface AdsbdbAircraftBody {
  response?: { aircraft?: { registered_owner?: string } } | string;
}

interface HexdbAircraftBody {
  RegisteredOwners?: string;
}

const TTL_MS = 24 * 60 * 60 * 1000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registered operator by ICAO hex — fills the AIRLINE column for charter,
 * cargo, and other flights with no published route. adsbdb first, hexdb
 * as fallback. Tri-state like the other clients: string | null (definitive,
 * cached) | undefined (transient, retryable).
 */
export class AircraftInfo {
  private cache: TtlCache<string>;

  constructor(
    storage: Storage | null,
    private adsbdbBase = 'https://api.adsbdb.com/v0',
    private hexdbBase = 'https://hexdb.io/api/v1',
    now: () => number = Date.now,
    private timeoutMs = 10_000,
  ) {
    this.cache = new TtlCache<string>('flightwall.aircraft.v1', storage, TTL_MS, 300, now);
  }

  async getOperator(hex: string): Promise<string | null | undefined> {
    if (hex.startsWith('~')) return null; // non-ICAO address, no registry entry
    const cached = this.cache.get(hex);
    if (cached !== undefined) return cached;

    const primary = await this.fromAdsbdb(hex);
    if (primary === undefined) return undefined; // transient — retry later
    if (primary !== null) {
      this.cache.set(hex, primary);
      return primary;
    }

    const fallback = await this.fromHexdb(hex);
    if (fallback === undefined) return undefined;
    this.cache.set(hex, fallback);
    return fallback;
  }

  private async fromAdsbdb(hex: string): Promise<string | null | undefined> {
    try {
      const res = await fetchWithTimeout(
        `${this.adsbdbBase}/aircraft/${encodeURIComponent(hex)}`, this.timeoutMs);
      if (res.status === 404) return null;
      if (!res.ok) return undefined;
      const body: AdsbdbAircraftBody = await res.json();
      const ac = typeof body.response === 'object' ? body.response?.aircraft : undefined;
      const owner = ac?.registered_owner?.trim();
      return owner ? owner : null;
    } catch {
      return undefined;
    }
  }

  private async fromHexdb(hex: string): Promise<string | null | undefined> {
    try {
      const res = await fetchWithTimeout(
        `${this.hexdbBase}/aircraft/${encodeURIComponent(hex)}`, this.timeoutMs);
      if (res.status === 404) return null;
      if (!res.ok) return undefined;
      const body: HexdbAircraftBody = await res.json();
      const owner = body.RegisteredOwners?.trim();
      return owner ? owner : null;
    } catch {
      return undefined;
    }
  }
}
