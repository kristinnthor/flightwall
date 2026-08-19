import type { Aircraft } from './types';
import { haversineKm } from './geo';

/** One recorded position on an aircraft's path. */
export interface TrackPoint {
  lat: number;
  lon: number;
  altitudeFt: number;
  /** ms epoch, supplied by the caller — never read from the clock in here. */
  t: number;
}

export interface TrackStoreOptions {
  /** Points kept per aircraft before the oldest are dropped. */
  maxPoints?: number;
  /** Aircraft kept before the least recently seen is evicted. */
  maxTracks?: number;
  /** Movement below this is treated as noise and not recorded. */
  minMoveKm?: number;
}

const DEFAULT_MAX_POINTS = 1200;
const DEFAULT_MAX_TRACKS = 500;
const DEFAULT_MIN_MOVE_KM = 0.05;

// Frozen because every get() for an unknown hex hands back this same instance:
// `readonly` is erased at runtime, so without the freeze one caller mutating
// the result would corrupt the empty track for every later caller.
const EMPTY: readonly TrackPoint[] = Object.freeze([]);

/**
 * In-memory history of where each aircraft has been, accumulated forward from
 * app start. Nothing is persisted: a reload (including the 04:00 maintenance
 * reload) starts the trails over, and the API only reports aircraft currently
 * in radius, so there is no backfill.
 *
 * Pruning is purely time based and deliberately independent of who is in the
 * latest snapshot — an aircraft that has left the radius keeps its trail until
 * the points age out, which is the whole point of drawing paths.
 */
export class TrackStore {
  // Map iteration order doubles as the LRU: appending re-inserts a hex at the
  // end, so the first key is always the least recently seen.
  private points = new Map<string, TrackPoint[]>();
  private readonly maxPoints: number;
  private readonly maxTracks: number;
  private readonly minMoveKm: number;

  constructor(options: TrackStoreOptions = {}) {
    this.maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
    this.maxTracks = options.maxTracks ?? DEFAULT_MAX_TRACKS;
    this.minMoveKm = options.minMoveKm ?? DEFAULT_MIN_MOVE_KM;
  }

  /** Record the current positions. Call once per successful poll. */
  append(aircraft: Aircraft[], now: number): void {
    for (const a of aircraft) {
      const existing = this.points.get(a.hex);
      const track = existing ?? [];
      const last = track.length > 0 ? track[track.length - 1] : undefined;
      const moved = !last || haversineKm(last.lat, last.lon, a.lat, a.lon) >= this.minMoveKm;

      if (moved) {
        track.push({ lat: a.lat, lon: a.lon, altitudeFt: a.altitudeFt, t: now });
        if (track.length > this.maxPoints) track.splice(0, track.length - this.maxPoints);
      }

      // Re-insert even when the aircraft has not moved, so a slow or holding
      // target is not evicted as stale while it is plainly still up there.
      if (existing) this.points.delete(a.hex);
      this.points.set(a.hex, track);
    }

    while (this.points.size > this.maxTracks) {
      const oldest = this.points.keys().next();
      if (oldest.done) break;
      this.points.delete(oldest.value);
    }
  }

  /** Drop points older than the window, and any track left with none. */
  prune(now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    for (const [hex, track] of this.points) {
      let keepFrom = 0;
      while (keepFrom < track.length && track[keepFrom]!.t < cutoff) keepFrom++;
      if (keepFrom > 0) track.splice(0, keepFrom);
      if (track.length === 0) this.points.delete(hex);
    }
  }

  get(hex: string): readonly TrackPoint[] {
    return this.points.get(hex) ?? EMPTY;
  }

  tracks(): ReadonlyMap<string, readonly TrackPoint[]> {
    return this.points;
  }
}
