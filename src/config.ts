import type { Config } from './types';

const STORAGE_KEY = 'flightwall.config';

// Must match the cache keys used in api/routes.ts and api/photos.ts.
const ALL_KEYS = [STORAGE_KEY, 'flightwall.routes.v1', 'flightwall.photos.v1'];

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
    (o.label === undefined || typeof o.label === 'string')
  );
}

export function parseHash(hash: string): Config | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  const rRaw = params.get('r');
  if (!latRaw || !lonRaw || !rRaw) return null;
  const cfg: Record<string, unknown> = {
    lat: Number(latRaw),
    lon: Number(lonRaw),
    radiusKm: Number(rRaw),
  };
  const label = params.get('label');
  if (label) cfg.label = label;
  return isValidConfig(cfg) ? cfg : null;
}

export function serializeToHash(cfg: Config): string {
  const params = new URLSearchParams();
  params.set('lat', String(cfg.lat));
  params.set('lon', String(cfg.lon));
  params.set('r', String(cfg.radiusKm));
  if (cfg.label) params.set('label', cfg.label);
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
