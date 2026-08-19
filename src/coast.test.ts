import { describe, it, expect, vi } from 'vitest';
import { CoastlineStore, tileKeysForBounds } from './coast';

interface CoastIndexShape {
  tileDeg: number;
  tiles: string[];
}

const INDEX = { tileDeg: 10, tiles: ['60_-30', '60_-20', '50_-30', '0_170', '0_-180'] };

/** Fetch double: routes paths to canned bodies and counts calls per path. */
function fakeFetch(bodies: Record<string, unknown | 'notfound' | 'throw' | 'badjson'>) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(url);
    const path = url.slice(url.lastIndexOf('/') + 1);
    const body = bodies[path];
    if (body === undefined || body === 'notfound') {
      return { ok: false, json: async () => ({}) };
    }
    if (body === 'throw') throw new Error('network down');
    if (body === 'badjson') {
      return { ok: true, json: async () => { throw new SyntaxError('unexpected token'); } };
    }
    return { ok: true, json: async () => body };
  });
  return { impl, calls };
}

describe('tileKeysForBounds', () => {
  it('returns a single key for a box inside one cell', () => {
    expect(tileKeysForBounds(64, -22, 65, -21, 10)).toEqual(['60_-30']);
  });

  it('covers both cells when the box spans a longitude boundary', () => {
    const keys = tileKeysForBounds(64, -22, 65, -18, 10);
    expect(keys).toContain('60_-30');
    expect(keys).toContain('60_-20');
    expect(keys).toHaveLength(2);
  });

  it('covers all four cells at a corner', () => {
    const keys = tileKeysForBounds(58, -22, 62, -18, 10);
    expect(new Set(keys)).toEqual(new Set(['50_-30', '50_-20', '60_-30', '60_-20']));
  });

  it('floors negative latitudes and longitudes toward the south-west corner', () => {
    expect(tileKeysForBounds(-5, -5, -5, -5, 10)).toEqual(['-10_-10']);
  });

  it('walks through the antimeridian rather than around the globe', () => {
    const keys = tileKeysForBounds(0, 175, 1, -175, 10);
    expect(keys).toEqual(['0_170', '0_-180']);
  });
});

describe('CoastlineStore', () => {
  it('loads only the tiles overlapping the bounds', async () => {
    const tile = { lines: [[-22, 64, -21, 64.5]] };
    const { impl, calls } = fakeFetch({ 'index.json': INDEX, '60_-30.json': tile });
    const store = new CoastlineStore('./coast', impl);
    expect(await store.load(64, -22, 65, -21)).toEqual([tile]);
    expect(calls).toEqual(['./coast/index.json', './coast/60_-30.json']);
  });

  it('skips keys the index does not list instead of requesting them', async () => {
    // 60_-40 has no land, so the generator emitted no file for it.
    const { impl, calls } = fakeFetch({ 'index.json': INDEX, '60_-30.json': { lines: [] } });
    const store = new CoastlineStore('./coast', impl);
    await store.load(64, -35, 65, -21);
    expect(calls).not.toContain('./coast/60_-40.json');
  });

  it('memoises a tile across repeated loads', async () => {
    const tile = { lines: [[0, 0, 1, 1]] };
    const { impl, calls } = fakeFetch({ 'index.json': INDEX, '60_-30.json': tile });
    const store = new CoastlineStore('./coast', impl);
    await store.load(64, -22, 65, -21);
    await store.load(64, -22, 65, -21);
    expect(calls.filter((c) => c.endsWith('60_-30.json'))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith('index.json'))).toHaveLength(1);
  });

  // Every failure below must resolve empty: the scope still draws rings and
  // aircraft without a coastline, so none of this may reach the render path.
  it('resolves empty when the network throws', async () => {
    const { impl } = fakeFetch({ 'index.json': 'throw' });
    await expect(new CoastlineStore('./coast', impl).load(64, -22, 65, -21)).resolves.toEqual([]);
  });

  it('resolves empty when the index is missing', async () => {
    const { impl } = fakeFetch({ 'index.json': 'notfound' });
    await expect(new CoastlineStore('./coast', impl).load(64, -22, 65, -21)).resolves.toEqual([]);
  });

  it('resolves empty when the index is malformed', async () => {
    const { impl } = fakeFetch({ 'index.json': { nonsense: true } });
    await expect(new CoastlineStore('./coast', impl).load(64, -22, 65, -21)).resolves.toEqual([]);
  });

  it('drops a tile that 404s but keeps its siblings', async () => {
    const good = { lines: [[-19, 64, -18, 64.5]] };
    const { impl } = fakeFetch({
      'index.json': INDEX,
      '60_-30.json': 'notfound',
      '60_-20.json': good,
    });
    expect(await new CoastlineStore('./coast', impl).load(64, -22, 65, -18)).toEqual([good]);
  });

  it('drops a tile whose JSON does not parse', async () => {
    const { impl } = fakeFetch({ 'index.json': INDEX, '60_-30.json': 'badjson' });
    await expect(new CoastlineStore('./coast', impl).load(64, -22, 65, -21)).resolves.toEqual([]);
  });

  it('drops a tile whose shape is wrong', async () => {
    const { impl } = fakeFetch({ 'index.json': INDEX, '60_-30.json': { lines: 'nope' } });
    await expect(new CoastlineStore('./coast', impl).load(64, -22, 65, -21)).resolves.toEqual([]);
  });

  it('uses relative paths so Tizen and Pages both resolve them', async () => {
    const { impl, calls } = fakeFetch({ 'index.json': INDEX, '60_-30.json': { lines: [] } });
    await new CoastlineStore('./coast', impl).load(64, -22, 65, -21);
    for (const c of calls) expect(c.startsWith('./')).toBe(true);
  });
});

// Guards the committed artifact in CI: the tiles are generated by hand with
// scripts/build-coastline.mjs, so nothing else would catch a truncated or
// mis-keyed commit. Read as raw strings through Vite rather than node:fs, which
// would need Node types in a browser-only tsconfig.
const RAW = import.meta.glob('../public/coast/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);

describe('generated coastline data', () => {
  const index = JSON.parse(RAW['../public/coast/index.json']!) as CoastIndexShape;
  const tileNames = Object.keys(RAW).map(nameOf).filter((n) => n !== 'index');

  it('index matches the tiles actually committed', () => {
    expect(index.tileDeg).toBe(10);
    expect(index.tiles.length).toBeGreaterThan(0);
    expect(new Set(index.tiles)).toEqual(new Set(tileNames));
  });

  it('covers Iceland, the location this wall was built for', () => {
    expect(index.tiles).toContain('60_-30');
    expect(index.tiles).toContain('60_-20');
  });

  it('stays within the 3 MB budget', () => {
    const bytes = Object.values(RAW).reduce((sum, s) => sum + s.length, 0);
    expect(bytes).toBeLessThan(3_000_000);
  });

  // Aggregate rather than asserting per point: 77k points would mean ~300k
  // expect() calls and several seconds of CI for one bit of information.
  it('every tile holds coordinate pairs within its own cell', () => {
    const bad: string[] = [];
    for (const key of index.tiles) {
      const parts = key.split('_');
      const swLat = Number(parts[0]);
      const swLon = Number(parts[1]);
      const tile = JSON.parse(RAW[`../public/coast/${key}.json`]!) as { lines: number[][] };
      for (const line of tile.lines) {
        if (line.length % 2 !== 0 || line.length < 4) bad.push(`${key}: bad line length ${line.length}`);
        for (let i = 0; i < line.length; i += 2) {
          const lon = line[i]!;
          const lat = line[i + 1]!;
          // Runs overlap their neighbour by one segment, so allow a cell of slack.
          const lonOk = lon >= swLon - 10 && lon <= swLon + 20;
          const latOk = lat >= swLat - 10 && lat <= swLat + 20;
          if (!lonOk || !latOk) bad.push(`${key}: (${lon}, ${lat}) outside cell`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
