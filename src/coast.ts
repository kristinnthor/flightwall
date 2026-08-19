/** One tile of coastline geometry: flat [lon, lat, lon, lat, ...] per line. */
export interface CoastTile {
  lines: number[][];
}

interface CoastIndex {
  tileDeg: number;
  tiles: string[];
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const DEFAULT_TILE_DEG = 10;

function isIndex(value: unknown): value is CoastIndex {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.tileDeg === 'number' && Number.isFinite(o.tileDeg) && o.tileDeg > 0 &&
    Array.isArray(o.tiles) && o.tiles.every((t) => typeof t === 'string')
  );
}

function isTile(value: unknown): value is CoastTile {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    Array.isArray(o.lines) &&
    o.lines.every((l) => Array.isArray(l) && l.every((n) => typeof n === 'number'))
  );
}

/** Normalize a longitude into [-180, 180) so tile keys match the generator's. */
function wrapLon(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

/**
 * Tile keys covering a bounding box. `maxLon` below `minLon` means the box
 * wraps the antimeridian, which is walked through rather than around.
 */
export function tileKeysForBounds(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  tileDeg: number,
): string[] {
  const keys: string[] = [];
  const lat0 = Math.floor(Math.min(minLat, maxLat) / tileDeg) * tileDeg;
  const lat1 = Math.floor(Math.max(minLat, maxLat) / tileDeg) * tileDeg;
  const lonEnd = maxLon < minLon ? maxLon + 360 : maxLon;
  for (let lat = lat0; lat <= lat1; lat += tileDeg) {
    const start = Math.floor(minLon / tileDeg) * tileDeg;
    for (let lon = start; lon <= lonEnd; lon += tileDeg) {
      const key = `${lat}_${wrapLon(lon)}`;
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * Fetches the coastline tiles overlapping a view, memoised per tile.
 *
 * Every failure path — offline, 404, malformed JSON — resolves to no geometry
 * rather than rejecting. A scope with no coastline still draws its rings and
 * aircraft, so a missing tile must never reach the render path as an error.
 */
export class CoastlineStore {
  private indexPromise: Promise<CoastIndex | null> | null = null;
  private tiles = new Map<string, Promise<CoastTile | null>>();

  constructor(
    private baseUrl = './coast',
    private fetchImpl: FetchLike = (url) => fetch(url),
  ) {}

  private async getJson(path: string): Promise<unknown> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/${path}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null; // offline, blocked, or malformed — treated as "no coastline"
    }
  }

  private loadIndex(): Promise<CoastIndex | null> {
    if (!this.indexPromise) {
      this.indexPromise = this.getJson('index.json').then((raw) => (isIndex(raw) ? raw : null));
    }
    return this.indexPromise;
  }

  private loadTile(key: string): Promise<CoastTile | null> {
    const existing = this.tiles.get(key);
    if (existing) return existing;
    const pending = this.getJson(`${key}.json`).then((raw) => (isTile(raw) ? raw : null));
    this.tiles.set(key, pending);
    return pending;
  }

  async load(minLat: number, minLon: number, maxLat: number, maxLon: number): Promise<CoastTile[]> {
    const index = await this.loadIndex();
    // Without an index every request would be a guess; the generator emits no
    // file for open ocean, so unknown keys are skipped rather than 404'd.
    const tileDeg = index ? index.tileDeg : DEFAULT_TILE_DEG;
    const wanted = tileKeysForBounds(minLat, minLon, maxLat, maxLon, tileDeg);
    const present = index ? wanted.filter((k) => index.tiles.indexOf(k) !== -1) : [];
    const loaded = await Promise.all(present.map((k) => this.loadTile(k)));
    const out: CoastTile[] = [];
    for (const tile of loaded) {
      if (tile) out.push(tile);
    }
    return out;
  }
}
