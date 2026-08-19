import { describe, it, expect } from 'vitest';
import { MapView, headingFor, trailBands, viewBounds } from './map';
import type { Aircraft, Config } from '../types';
import type { Snapshot } from '../state';
import type { TrackPoint } from '../tracks';

const CFG: Config = { lat: 64, lon: -21, radiusKm: 100, label: 'HOME' };

function ac(hex: string, over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex,
    callsign: `CS${hex.toUpperCase()}`,
    registration: null,
    typeCode: null,
    altitudeFt: 34000,
    groundSpeedKt: 450,
    verticalRateFpm: 0,
    distanceKm: 10,
    bearingDeg: 315,
    track: null,
    lat: 64.1,
    lon: -21,
    ...over,
  };
}

const snap = (aircraft: Aircraft[]): Snapshot => ({
  aircraft,
  entered: new Set(),
  left: new Set(),
  lastSuccessAt: 1000,
});

const pt = (lat: number, lon: number, t: number): TrackPoint => ({
  lat,
  lon,
  altitudeFt: 30000,
  t,
});

/**
 * Recording stub for CanvasRenderingContext2D. happy-dom has no 2D backend, so
 * getContext('2d') returns null and there is nothing real to assert against.
 */
function stubContext() {
  const calls: { op: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  const ctx = {
    calls,
    state,
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    clip: record('clip'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    clearRect: record('clearRect'),
    fillText: record('fillText'),
    translate: record('translate'),
    rotate: record('rotate'),
    set globalAlpha(v: number) {
      calls.push({ op: 'globalAlpha', args: [v] });
    },
    get globalAlpha() {
      return 1;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    font: '',
  };
  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

const root = (): HTMLElement => document.createElement('div');
const opsOf = (ctx: ReturnType<typeof stubContext>, op: string) =>
  ctx.calls.filter((c) => c.op === op);
const textsOf = (ctx: ReturnType<typeof stubContext>) =>
  ctx.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));

describe('headingFor', () => {
  it('prefers the track reported by the feed', () => {
    expect(headingFor(ac('a', { track: 270 }), [pt(64, -21, 0), pt(65, -21, 1)])).toBe(270);
  });

  it('falls back to the bearing between the last two recorded points', () => {
    const h = headingFor(ac('a'), [pt(64, -21, 0), pt(65, -21, 1)]);
    expect(h).toBeCloseTo(0, 0); // due north
  });

  it('uses only the final two points, not the whole trail', () => {
    const h = headingFor(ac('a'), [pt(60, -21, 0), pt(64, -21, 1), pt(64, -20, 2)]);
    expect(h).toBeCloseTo(90, 0); // due east
  });

  it('returns null for a brand new contact with one point', () => {
    expect(headingFor(ac('a'), [pt(64, -21, 0)])).toBeNull();
  });

  it('returns null with no trail at all', () => {
    expect(headingFor(ac('a'), [])).toBeNull();
  });

  it('returns null rather than a bogus bearing for two identical points', () => {
    expect(headingFor(ac('a'), [pt(64, -21, 0), pt(64, -21, 1)])).toBeNull();
  });

  // bearingDeg is the bearing FROM home; using it would fan every target outward.
  it('never falls back to bearingDeg', () => {
    expect(headingFor(ac('a', { bearingDeg: 315 }), [])).toBeNull();
  });
});

describe('trailBands', () => {
  const trail = (n: number) => Array.from({ length: n }, (_, i) => pt(64 + i * 0.01, -21, i));

  it('returns nothing for a trail too short to draw', () => {
    expect(trailBands([])).toEqual([]);
    expect(trailBands([pt(64, -21, 0)])).toEqual([]);
  });

  it('ramps alpha upward, brightest last', () => {
    const bands = trailBands(trail(60));
    const alphas = bands.map((b) => b.alpha);
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
    expect(alphas[alphas.length - 1]).toBeCloseTo(1, 6);
    expect(alphas[0]!).toBeGreaterThan(0);
    expect(alphas[0]!).toBeLessThan(1);
  });

  it('covers every segment of the trail with no gaps', () => {
    const points = trail(37);
    const bands = trailBands(points);
    expect(bands[0]!.points[0]).toBe(points[0]);
    expect(bands[bands.length - 1]!.points.slice(-1)[0]).toBe(points[points.length - 1]);
    // Each band starts where the previous ended, so the line is continuous.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.points[0]).toBe(bands[i - 1]!.points.slice(-1)[0]);
    }
  });

  it('never emits more bands than there are segments', () => {
    expect(trailBands(trail(3)).length).toBeLessThanOrEqual(2);
    expect(trailBands(trail(2))).toHaveLength(1);
  });
});

describe('viewBounds', () => {
  it('brackets the home point', () => {
    const [minLat, minLon, maxLat, maxLon] = viewBounds(CFG);
    expect(minLat).toBeLessThan(CFG.lat);
    expect(maxLat).toBeGreaterThan(CFG.lat);
    expect(minLon).toBeLessThan(CFG.lon);
    expect(maxLon).toBeGreaterThan(CFG.lon);
  });

  it('widens longitude at high latitude, where degrees are shorter', () => {
    const equator = viewBounds({ lat: 0, lon: 0, radiusKm: 100 });
    const arctic = viewBounds({ lat: 70, lon: 0, radiusKm: 100 });
    expect(arctic[3] - arctic[1]).toBeGreaterThan(equator[3] - equator[1]);
  });
});

describe('MapView', () => {
  it('survives a browser with no 2D context and draws nothing', () => {
    const view = new MapView(root(), CFG, undefined, { context: null });
    expect(() => view.update(snap([ac('a')]), new Map())).not.toThrow();
  });

  it('appends a fixed 1920x1080 canvas to the stage', () => {
    const r = root();
    new MapView(r, CFG, undefined, { context: stubContext() });
    const canvas = r.querySelector('canvas')!;
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
  });

  it('draws rings and the home marker even with an empty sky', () => {
    const ctx = stubContext();
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([]), new Map());
    expect(opsOf(ctx, 'arc').length).toBeGreaterThanOrEqual(3); // ring set
    expect(textsOf(ctx)).toContain('N');
    expect(textsOf(ctx)).toContain('100 KM'); // outer ring is the config radius
    expect(opsOf(ctx, 'stroke').length).toBeGreaterThan(0);
  });

  it('rotates an aircraft with a known heading and does not rotate one without', () => {
    const ctx = stubContext();
    const view = new MapView(root(), CFG, undefined, { context: ctx });
    view.update(snap([ac('a', { track: 90 })]), new Map());
    expect(opsOf(ctx, 'rotate')).toHaveLength(1);

    const ctx2 = stubContext();
    new MapView(root(), CFG, undefined, { context: ctx2 }).update(snap([ac('b')]), new Map());
    expect(opsOf(ctx2, 'rotate')).toHaveLength(0);
  });

  it('draws a trail of N points as a polyline', () => {
    const ctx = stubContext();
    const tracks = new Map<string, readonly TrackPoint[]>([
      ['a', [pt(64, -21, 0), pt(64.05, -21, 1), pt(64.1, -21, 2)]],
    ]);
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([ac('a')]), tracks);
    // 3 points => 2 segments => at least 2 lineTo across the bands.
    expect(opsOf(ctx, 'lineTo').length).toBeGreaterThanOrEqual(2);
    const alphas = opsOf(ctx, 'globalAlpha').map((c) => c.args[0] as number);
    expect(alphas.some((a) => a > 0 && a < 1)).toBe(true);
  });

  it('draws an aircraft with a single trail point but no trail line', () => {
    const ctx = stubContext();
    const tracks = new Map<string, readonly TrackPoint[]>([['a', [pt(64.1, -21, 0)]]]);
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([ac('a')]), tracks);
    expect(textsOf(ctx).some((t) => t.startsWith('CSA'))).toBe(true);
  });

  it('labels an aircraft with callsign and altitude', () => {
    const ctx = stubContext();
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([ac('a')]), new Map());
    expect(textsOf(ctx).some((t) => t.includes('CSA'))).toBe(true);
  });

  it('drops labels that would overlap, keeping the nearer aircraft', () => {
    const ctx = stubContext();
    // Same position, so the boxes collide; nearest-first order decides.
    const near = ac('near', { distanceKm: 1, lat: 64.1, lon: -21 });
    const far = ac('far', { distanceKm: 90, lat: 64.1, lon: -21 });
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([near, far]), new Map());
    const texts = textsOf(ctx);
    expect(texts.some((t) => t.includes('CSNEAR'))).toBe(true);
    expect(texts.some((t) => t.includes('CSFAR'))).toBe(false);
  });

  it('keeps both labels when the aircraft are well apart', () => {
    const ctx = stubContext();
    const a = ac('a', { lat: 64.4, lon: -21 });
    const b = ac('b', { lat: 63.6, lon: -21 });
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([a, b]), new Map());
    const texts = textsOf(ctx);
    expect(texts.some((t) => t.includes('CSA'))).toBe(true);
    expect(texts.some((t) => t.includes('CSB'))).toBe(true);
  });

  it('falls back to the hex when an aircraft has no callsign', () => {
    const ctx = stubContext();
    const a = ac('abc123', { callsign: null });
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([a]), new Map());
    expect(textsOf(ctx).some((t) => t.includes('ABC123'))).toBe(true);
  });

  it('shows the configured label, radius and aircraft count', () => {
    const ctx = stubContext();
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([ac('a')]), new Map());
    const texts = textsOf(ctx);
    expect(texts).toContain('OVERHEAD · HOME');
    expect(texts).toContain('WITHIN 100 KM');
    expect(texts).toContain('1 AIRCRAFT');
  });

  it('credits every data source in the footer', () => {
    const ctx = stubContext();
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([]), new Map());
    const footer = textsOf(ctx).find((t) => t.includes('AIRPLANES.LIVE'))!;
    expect(footer).toContain('NATURAL EARTH');
    expect(footer).toContain('ADSBDB');
    expect(footer).toContain('PLANESPOTTERS.NET');
  });

  it('hides and shows the canvas for the view toggle', () => {
    const r = root();
    const view = new MapView(r, CFG, undefined, { context: stubContext() });
    view.setVisible(false);
    expect(r.querySelector('canvas')!.hidden).toBe(true);
    view.setVisible(true);
    expect(r.querySelector('canvas')!.hidden).toBe(false);
  });

  it('keeps drawing trails for aircraft no longer in the snapshot', () => {
    const ctx = stubContext();
    const tracks = new Map<string, readonly TrackPoint[]>([
      ['gone', [pt(64, -21, 0), pt(64.1, -21, 1)]],
    ]);
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([]), tracks);
    expect(opsOf(ctx, 'lineTo').length).toBeGreaterThan(0);
  });

  it('never calls roundRect, which Chromium 85 does not have', () => {
    const ctx = stubContext();
    const tracks = new Map<string, readonly TrackPoint[]>([
      ['a', [pt(64, -21, 0), pt(64.1, -21, 1)]],
    ]);
    new MapView(root(), CFG, undefined, { context: ctx }).update(snap([ac('a')]), tracks);
    expect(ctx.calls.some((c) => c.op === 'roundRect')).toBe(false);
  });
});
