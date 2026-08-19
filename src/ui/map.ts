import type { Aircraft, Config } from '../types';
import type { Snapshot } from '../state';
import type { TrackPoint } from '../tracks';
import type { CoastlineStore } from '../coast';
import { computeStatus } from '../state';
import { initialBearingDeg } from '../geo';
import { formatAlt, formatAgeSeconds } from '../format';
import { makeProjector, ringRadiiKm, placeLabels, type Projector } from './mapproject';
import { attributionFor } from './board';
import { STAGE_W, STAGE_H } from '../stage';

// Mirrors the custom properties in styles.css — canvas cannot read them.
const COLOR_BG = '#07080a';
const COLOR_AMBER = '#ffb000';
const COLOR_AMBER_DIM = '#b37c00';
const COLOR_WHITE = '#e8e2d0';
const COLOR_DIM = '#6b675c';
const COLOR_COAST = '#3d4852';
const COLOR_GREEN = '#3fbf5a';
const COLOR_RED = '#e0442c';

const CX = STAGE_W / 2;
const CY = STAGE_H / 2 + 20;
const SCOPE_R = 452;
const FONT = 'B612 Mono, monospace';

/** Monospace, so width is predictable without measureText — which keeps the
 *  label declutter deterministic and testable against a stub context. */
const CHAR_W = 0.6;

const TRAIL_BANDS = 6;
const MIN_ALPHA = 0.15;

const toRad = (d: number): number => (d * Math.PI) / 180;

/**
 * Direction the aircraft is pointing, in degrees.
 *
 * `Aircraft.bearingDeg` is the bearing FROM home, so using it here would point
 * every target radially outward — plausible enough on screen to ship by
 * accident. Prefer the feed's own track; fall back to the direction between the
 * last two recorded positions; give up rather than guess for a brand new
 * contact with one point.
 */
export function headingFor(a: Aircraft, track: readonly TrackPoint[]): number | null {
  if (a.track !== null) return a.track;
  if (track.length >= 2) {
    const prev = track[track.length - 2]!;
    const last = track[track.length - 1]!;
    if (prev.lat !== last.lat || prev.lon !== last.lon) {
      return initialBearingDeg(prev.lat, prev.lon, last.lat, last.lon);
    }
  }
  return null;
}

export interface TrailBand {
  alpha: number;
  points: readonly TrackPoint[];
}

/**
 * Split a trail into constant-alpha bands, oldest faintest, so recency reads as
 * brightness. Banded rather than per segment: a 720-point trail would otherwise
 * be 720 separate strokes per aircraft, which a 2022 TV will not enjoy.
 * Consecutive bands share a point so the line has no gaps at the seams.
 */
export function trailBands(points: readonly TrackPoint[], bands = TRAIL_BANDS): TrailBand[] {
  if (points.length < 2) return [];
  const count = Math.min(bands, points.length - 1);
  const out: TrailBand[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * (points.length - 1)) / count);
    const end = Math.floor(((i + 1) * (points.length - 1)) / count);
    if (end <= start) continue;
    out.push({
      alpha: MIN_ALPHA + (1 - MIN_ALPHA) * ((i + 1) / count),
      points: points.slice(start, end + 1),
    });
  }
  return out;
}

/** Half-extent of the view in degrees, used to ask for coastline tiles. */
export function viewBounds(config: Config): [number, number, number, number] {
  const dLat = config.radiusKm / 111.19;
  const cosLat = Math.max(0.01, Math.cos(toRad(config.lat)));
  const dLon = config.radiusKm / (111.19 * cosLat);
  return [config.lat - dLat, config.lon - dLon, config.lat + dLat, config.lon + dLon];
}

export interface MapViewOptions {
  /** Injected in tests — happy-dom has no 2D backend, so getContext returns null. */
  context?: CanvasRenderingContext2D | null;
}

/**
 * Full-stage radar scope: home at the centre, range rings, offline coastline,
 * current aircraft and their recent paths. Draws nothing at all without a 2D
 * context rather than throwing, so a browser that cannot give us one still
 * leaves the rest of the app working.
 */
export class MapView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private project: Projector;
  private rings: number[];
  /** Coastline pre-projected to pixels: the projector never changes, so this is
   *  computed once instead of re-projecting thousands of points every redraw. */
  private coastPx: number[][] = [];
  /** Last frame's inputs, so the async coastline can repaint what is on screen
   *  instead of waiting for the next poll to reveal the geography. */
  private lastSnap: Snapshot | null = null;
  private lastTracks: ReadonlyMap<string, readonly TrackPoint[]> = new Map();
  private lastNow = 0;
  private source = 'AIRPLANES.LIVE';
  private hasDrawn = false;

  constructor(
    root: HTMLElement,
    private config: Config,
    coast?: CoastlineStore,
    options: MapViewOptions = {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map';
    this.canvas.width = STAGE_W;
    this.canvas.height = STAGE_H;
    root.appendChild(this.canvas);

    this.ctx = options.context !== undefined ? options.context : this.canvas.getContext('2d');
    this.project = makeProjector(config, CX, CY, SCOPE_R);
    this.rings = ringRadiiKm(config.radiusKm);

    if (coast) {
      const [minLat, minLon, maxLat, maxLon] = viewBounds(config);
      void coast.load(minLat, minLon, maxLat, maxLon).then((tiles) => {
        for (const tile of tiles) {
          for (const line of tile.lines) {
            const px: number[] = [];
            for (let i = 0; i + 1 < line.length; i += 2) {
              const p = this.project(line[i + 1]!, line[i]!);
              px.push(p.x, p.y);
            }
            if (px.length >= 4) this.coastPx.push(px);
          }
        }
        // Repaint whatever is on screen, snapshot or not — the scope is drawn
        // before any data arrives, so waiting for one would hide the geography.
        if (this.coastPx.length > 0 && this.hasDrawn) {
          this.update(this.lastSnap, this.lastTracks, this.lastNow);
        }
      });
    }
  }

  setSource(label: string): void {
    this.source = label;
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible;
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Paint the scope. `snap` is null until the first successful poll — the rings,
   * coastline and compass are drawn regardless, because a feed that is failing
   * must look like a failing feed rather than like an empty sky.
   */
  update(
    snap: Snapshot | null,
    tracks: ReadonlyMap<string, readonly TrackPoint[]>,
    now: number,
  ): void {
    this.lastSnap = snap;
    this.lastTracks = tracks;
    this.lastNow = now;
    const ctx = this.ctx;
    if (!ctx) return; // no 2D backend — nothing to draw, and nothing to crash
    this.hasDrawn = true;

    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    this.drawCoast(ctx);
    this.drawRings(ctx);
    this.drawTrails(ctx, tracks);
    if (snap) this.drawAircraft(ctx, snap.aircraft, tracks);
    this.drawHome(ctx);
    this.drawChrome(ctx, snap, now);
  }

  private drawCoast(ctx: CanvasRenderingContext2D): void {
    if (this.coastPx.length === 0) return;
    ctx.save();
    // Clipped to the scope so land does not spill into the chrome.
    ctx.beginPath();
    ctx.arc(CX, CY, SCOPE_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = COLOR_COAST;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const line of this.coastPx) {
      ctx.moveTo(line[0]!, line[1]!);
      for (let i = 2; i + 1 < line.length; i += 2) ctx.lineTo(line[i]!, line[i + 1]!);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawRings(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLOR_AMBER_DIM;
    ctx.fillStyle = COLOR_DIM;
    ctx.font = `16px ${FONT}`;
    ctx.lineWidth = 1;

    for (const km of this.rings) {
      const r = (km / this.config.radiusKm) * SCOPE_R;
      ctx.globalAlpha = km === this.config.radiusKm ? 0.75 : 0.35;
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Just inside the ring: outside would collide with the N compass mark.
      ctx.fillText(`${km} KM`, CX + 6, CY - r + 18);
    }

    // Compass ticks: cardinal directions at the outer ring.
    ctx.fillStyle = COLOR_DIM;
    ctx.font = `20px ${FONT}`;
    const marks: [string, number, number][] = [
      ['N', CX, CY - SCOPE_R - 14],
      ['S', CX, CY + SCOPE_R + 28],
      ['E', CX + SCOPE_R + 14, CY + 6],
      ['W', CX - SCOPE_R - 26, CY + 6],
    ];
    for (const [text, x, y] of marks) ctx.fillText(text, x, y);
  }

  private drawTrails(
    ctx: CanvasRenderingContext2D,
    tracks: ReadonlyMap<string, readonly TrackPoint[]>,
  ): void {
    ctx.strokeStyle = COLOR_AMBER;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [, points] of tracks) {
      for (const band of trailBands(points)) {
        ctx.globalAlpha = band.alpha;
        ctx.beginPath();
        let first = true;
        for (const p of band.points) {
          const { x, y } = this.project(p.lat, p.lon);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAircraft(
    ctx: CanvasRenderingContext2D,
    aircraft: Aircraft[],
    tracks: ReadonlyMap<string, readonly TrackPoint[]>,
  ): void {
    const fontPx = 16;
    ctx.font = `${fontPx}px ${FONT}`;

    // Nearest first is already the snapshot's order, so it doubles as label
    // priority: when labels collide the closer aircraft keeps its own.
    const candidates = aircraft.map((a) => {
      const { x, y } = this.project(a.lat, a.lon);
      const text = `${a.callsign ?? a.hex.toUpperCase()} ${formatAlt(a.altitudeFt)}`;
      return {
        key: a.hex,
        x: x + 12,
        y: y - 14,
        w: text.length * fontPx * CHAR_W,
        h: fontPx + 4,
        text,
        px: x,
        py: y,
        heading: headingFor(a, tracks.get(a.hex) ?? []),
      };
    });
    const placed = placeLabels(candidates);

    for (const c of candidates) {
      ctx.save();
      ctx.translate(c.px, c.py);
      ctx.fillStyle = COLOR_AMBER;
      if (c.heading === null) {
        // Unknown heading: a dot states less than an arrow pointing the wrong way.
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.rotate(toRad(c.heading));
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(6, 7);
        ctx.lineTo(0, 3);
        ctx.lineTo(-6, 7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      const at = placed.get(c.key);
      if (at) {
        ctx.fillStyle = COLOR_WHITE;
        ctx.fillText(c.text, at.x, at.y);
      }
    }
  }

  private drawHome(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLOR_WHITE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CX - 9, CY);
    ctx.lineTo(CX + 9, CY);
    ctx.moveTo(CX, CY - 9);
    ctx.lineTo(CX, CY + 9);
    ctx.stroke();
  }

  private drawChrome(ctx: CanvasRenderingContext2D, snap: Snapshot | null, now: number): void {
    ctx.fillStyle = COLOR_AMBER;
    ctx.font = `28px ${FONT}`;
    ctx.fillText(`OVERHEAD · ${(this.config.label ?? 'HOME').toUpperCase()}`, 48, 56);

    ctx.fillStyle = COLOR_DIM;
    ctx.font = `18px ${FONT}`;
    ctx.fillText(`WITHIN ${Math.round(this.config.radiusKm)} KM`, 48, 84);

    // "0 AIRCRAFT" reads the same whether the sky is empty or the feed is dead,
    // so the feed's own health is stated next to the count.
    const status = snap ? computeStatus(snap.lastSuccessAt, now) : 'lost';
    ctx.fillStyle =
      status === 'live' ? COLOR_GREEN : status === 'stale' ? COLOR_AMBER : COLOR_RED;
    ctx.fillText(
      snap
        ? `${snap.aircraft.length} AIRCRAFT · ${status.toUpperCase()}` +
            (status === 'live' ? '' : ` ${formatAgeSeconds(now - snap.lastSuccessAt)}`)
        : 'NO SIGNAL · WAITING FOR DATA',
      48,
      108,
    );
    ctx.fillStyle = COLOR_DIM;

    ctx.font = `14px ${FONT}`;
    ctx.fillText(attributionFor(this.source), 48, STAGE_H - 28);
  }
}
