import type { Config } from './types';

const STORAGE_KEY = 'flightwall.config';
/** Which of the two views was showing, so the 04:00 reload does not flip it. */
export const VIEW_KEY = 'flightwall.view';

export const DEFAULT_TRAIL_MINUTES = 60;
const MAX_TRAIL_MINUTES = 180;

// Must match the cache keys used in api/routes.ts and api/photos.ts.
const ALL_KEYS = [STORAGE_KEY, 'flightwall.routes.v1', 'flightwall.photos.v1', VIEW_KEY];

export function clearStoredConfig(storage: Storage): void {
  for (const key of ALL_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // storage unavailable: nothing to clear
    }
  }
}

export function isValidConfig(c: unknown): c is Config {
  if (typeof c !== 'object' || c === null) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.lat === 'number' && Number.isFinite(o.lat) && o.lat >= -90 && o.lat <= 90 &&
    typeof o.lon === 'number' && Number.isFinite(o.lon) && o.lon >= -180 && o.lon <= 180 &&
    typeof o.radiusKm === 'number' && Number.isFinite(o.radiusKm) &&
    o.radiusKm >= 1 && o.radiusKm <= 460 &&
    (o.label === undefined || typeof o.label === 'string') &&
    // Optional: a config saved before the map view existed has no trailMinutes
    // and must keep loading straight to the board.
    (o.trailMinutes === undefined ||
      (typeof o.trailMinutes === 'number' && Number.isFinite(o.trailMinutes) &&
        o.trailMinutes >= 0 && o.trailMinutes <= MAX_TRAIL_MINUTES))
  );
}

/**
 * A numeric hash parameter, trimmed, with blank treated as absent.
 *
 * `Number('')` and `Number(' ')` are both 0, and 0 is a perfectly valid
 * latitude and a perfectly valid "no trail" — so a blank or whitespace value
 * would otherwise parse as a deliberate zero rather than as missing.
 */
function numParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

export function parseHash(hash: string): Config | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const lat = numParam(params, 'lat');
  const lon = numParam(params, 'lon');
  const radiusKm = numParam(params, 'r');
  if (lat === undefined || lon === undefined || radiusKm === undefined) return null;
  const cfg: Record<string, unknown> = { lat, lon, radiusKm };
  const label = params.get('label');
  if (label) cfg.label = label;
  const trailMinutes = numParam(params, 't');
  if (trailMinutes !== undefined) cfg.trailMinutes = trailMinutes;
  return isValidConfig(cfg) ? cfg : null;
}

export function serializeToHash(cfg: Config): string {
  const params = new URLSearchParams();
  params.set('lat', String(cfg.lat));
  params.set('lon', String(cfg.lon));
  params.set('r', String(cfg.radiusKm));
  if (cfg.label) params.set('label', cfg.label);
  if (cfg.trailMinutes !== undefined) params.set('t', String(cfg.trailMinutes));
  return `#${params.toString()}`;
}

export function loadConfig(hash: string, storage: Storage): Config | null {
  const fromHash = parseHash(hash);
  if (fromHash) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(fromHash));
    } catch {
      // storage full/unavailable: config still works for this session
    }
    return fromHash;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Trail window in ms, falling back to the default when unset. */
export function trailWindowMs(cfg: Config): number {
  return (cfg.trailMinutes ?? DEFAULT_TRAIL_MINUTES) * 60_000;
}
