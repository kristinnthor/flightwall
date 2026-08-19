import type { Config } from '../types';
import { projectLocalKm } from '../geo';

/** Maps a geographic position to stage pixels on the radar scope. */
export type Projector = (lat: number, lon: number) => { x: number; y: number };

/**
 * Scope projector: home sits at (cx, cy) and `config.radiusKm` maps onto
 * `scopeRadiusPx`, so a target at the configured radius lands on the outer ring.
 */
export function makeProjector(
  config: Config,
  cx: number,
  cy: number,
  scopeRadiusPx: number,
): Projector {
  const pxPerKm = scopeRadiusPx / config.radiusKm;
  return (lat, lon) => {
    const { xKm, yKm } = projectLocalKm(config.lat, config.lon, lat, lon);
    return { x: cx + xKm * pxPerKm, y: cy - yKm * pxPerKm };
  };
}

// Round ring distances onto readable values instead of 16.67 km. Covers the
// whole 1-460 km config range; entries below 1 km keep the smallest radii sane.
const NICE_KM = [
  0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50,
  75, 100, 150, 200, 250, 300, 400, 500,
];

function nearestNice(km: number): number {
  let best = NICE_KM[0]!;
  let bestErr = Infinity;
  for (const n of NICE_KM) {
    const err = Math.abs(n - km);
    if (err < bestErr) {
      bestErr = err;
      best = n;
    }
  }
  return best;
}

/**
 * Range-ring distances, ascending, with the outermost ring exactly at
 * `radiusKm`. Inner rings sit near a third and two thirds of the radius, pulled
 * onto readable values — a ring labelled 15 km reads faster than 16.7 km.
 */
export function ringRadiiKm(radiusKm: number): number[] {
  const inner = [nearestNice(radiusKm / 3), nearestNice((radiusKm * 2) / 3)];
  const rings: number[] = [];
  for (const r of inner) {
    // Drop anything that rounded onto (or past) the outer ring, or that
    // collapsed onto a ring already placed.
    if (r > 0 && r < radiusKm && !rings.includes(r)) rings.push(r);
  }
  rings.sort((a, b) => a - b);
  rings.push(radiusKm);
  return rings;
}

export interface LabelCandidate {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: LabelCandidate, b: LabelCandidate): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Greedy non-overlapping label placement. Input order is priority order
 * (nearest first, matching the board); a candidate whose box intersects one
 * already placed is dropped rather than nudged, so a busy sky loses the least
 * interesting labels instead of turning into mush.
 */
export function placeLabels(candidates: LabelCandidate[]): Map<string, { x: number; y: number }> {
  const placed: LabelCandidate[] = [];
  const out = new Map<string, { x: number; y: number }>();
  for (const c of candidates) {
    if (placed.some((p) => overlaps(c, p))) continue;
    placed.push(c);
    out.set(c.key, { x: c.x, y: c.y });
  }
  return out;
}
