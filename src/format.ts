export const NM_TO_KM = 1.852;

export function nmToKm(nm: number): number {
  return nm * NM_TO_KM;
}

export function trimCallsign(raw: string | undefined): string | null {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t : null;
}

export function formatDistanceKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

export function formatAlt(ft: number): string {
  return Math.round(ft).toLocaleString('en-US');
}

export function climbArrow(fpm: number | null): '↑' | '↓' | '' {
  if (fpm === null || Math.abs(fpm) <= 256) return '';
  return fpm > 0 ? '↑' : '↓';
}

const POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

export function compass16(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[idx] as string;
}

export function formatAgeSeconds(ms: number): string {
  return `+${Math.floor(ms / 1000)}s`;
}
