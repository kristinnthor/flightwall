import type { Aircraft, Config } from './types';
import type { AircraftProvider } from './api/positions';

export interface Snapshot {
  aircraft: Aircraft[];
  entered: Set<string>;
  left: Set<string>;
  lastSuccessAt: number;
}

export interface PollLoopOptions {
  provider: AircraftProvider;
  config: Config;
  onUpdate: (snap: Snapshot) => void;
  onError?: (consecutiveFailures: number) => void;
  intervalMs?: number;
  isHidden?: () => boolean;
  now?: () => number;
  random?: () => number;
}

const STALE_MS = 15_000;
const LOST_MS = 60_000;
const MAX_BACKOFF_MS = 300_000;
const HIDDEN_RECHECK_MS = 1_000;

export function backoffDelay(
  failures: number,
  baseMs = 5_000,
  random: () => number = Math.random,
): number {
  const raw = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** (failures - 1));
  const jitterFactor = 0.8 + random() * 0.4; // ±20%
  return Math.min(MAX_BACKOFF_MS, Math.round(raw * jitterFactor));
}

export function computeStatus(lastSuccessAt: number, now: number): 'live' | 'stale' | 'lost' {
  const age = now - lastSuccessAt;
  if (age < STALE_MS) return 'live';
  if (age < LOST_MS) return 'stale';
  return 'lost';
}

export class PollLoop {
  lastTickAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private prevHexes = new Set<string>();
  private failures = 0;
  private stopped = true;
  private generation = 0;

  constructor(private opts: PollLoopOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation++;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const gen = this.generation;
    const now = this.opts.now ?? Date.now;
    this.lastTickAt = now();
    if (this.opts.isHidden?.()) {
      this.schedule(HIDDEN_RECHECK_MS);
      return;
    }
    const { lat, lon, radiusKm } = this.opts.config;
    try {
      const list = await this.opts.provider.fetchAircraft(lat, lon, radiusKm);
      if (this.stopped || gen !== this.generation) return;
      list.sort((a, b) => a.distanceKm - b.distanceKm);
      const hexes = new Set(list.map((a) => a.hex));
      const entered = new Set([...hexes].filter((h) => !this.prevHexes.has(h)));
      const left = new Set([...this.prevHexes].filter((h) => !hexes.has(h)));
      this.prevHexes = hexes;
      this.failures = 0;
      this.opts.onUpdate({ aircraft: list, entered, left, lastSuccessAt: now() });
      this.schedule(this.opts.intervalMs ?? 5_000);
    } catch {
      if (this.stopped || gen !== this.generation) return;
      this.failures++;
      this.opts.onError?.(this.failures);
      this.schedule(backoffDelay(this.failures, this.opts.intervalMs ?? 5_000, this.opts.random));
    }
  }
}
