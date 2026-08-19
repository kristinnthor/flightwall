#!/usr/bin/env node
// Generates the offline coastline tiles served from public/coast/.
//
// Dev-time only: run it by hand, commit the output. CI never fetches anything
// (npm ci -> typecheck -> test -> build has no network access), so the tiles are
// checked in rather than built.
//
// Source: Natural Earth 1:50m physical coastline + lakes, public domain.
// Taken from the nvkelso/natural-earth-vector GitHub mirror because Natural
// Earth's own CDN (naciscdn.org) is unreachable from some networks.
//
//   node scripts/build-coastline.mjs [--out public/coast] [--tolerance 0.002]
//                                    [--cache <dir>] [--tile-deg 10]
//
// The tiles are NOT content hashed, so after regenerating bump CACHE in
// public/sw.js or installed PWAs keep serving the old geometry.
//
// Tiles are named <swLat>_<swLon>.json at the grid's south-west corner and hold
// flat [lon, lat, lon, lat, ...] arrays. index.json lists the tiles that exist,
// so the runtime never requests an empty ocean cell.

import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MIRROR = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const LAYERS = ['ne_50m_coastline', 'ne_50m_lakes'];

function parseArgs(argv) {
  const out = { out: 'public/coast', tolerance: 0.002, cache: null, tileDeg: 10 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--out') out.out = val;
    else if (key === '--tolerance') out.tolerance = Number(val);
    else if (key === '--cache') out.cache = val;
    else if (key === '--tile-deg') out.tileDeg = Number(val);
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!Number.isFinite(out.tolerance) || out.tolerance < 0) throw new Error('bad --tolerance');
  if (!Number.isFinite(out.tileDeg) || out.tileDeg <= 0) throw new Error('bad --tile-deg');
  return out;
}

async function loadLayer(name, cacheDir) {
  const cached = cacheDir ? join(cacheDir, `${name}.geojson`) : null;
  if (cached && existsSync(cached)) {
    process.stdout.write(`  ${name}: cache\n`);
    return JSON.parse(await readFile(cached, 'utf8'));
  }
  const url = `${MIRROR}/${name}.geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const text = await res.text();
  if (cached) await writeFile(cached, text);
  process.stdout.write(`  ${name}: fetched ${(text.length / 1e6).toFixed(2)} MB\n`);
  return JSON.parse(text);
}

/** Every line in a layer as an array of [lon, lat] pairs. Polygon rings (lakes)
 *  become closed lines; the renderer strokes them, it does not fill. */
function linesOf(geometry) {
  const g = geometry;
  switch (g.type) {
    case 'LineString':
      return [g.coordinates];
    case 'MultiLineString':
      return g.coordinates;
    case 'Polygon':
      return g.coordinates;
    case 'MultiPolygon':
      return g.coordinates.flat();
    default:
      return [];
  }
}

/** Perpendicular distance from p to the segment ab, in degrees. */
function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cl = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + cl * dx), p[1] - (a[1] + cl * dy));
}

/** Douglas-Peucker, iterative so a 20k-point ring cannot blow the stack. */
function simplify(points, tolerance) {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const tileKey = (lat, lon, deg) => `${Math.floor(lat / deg) * deg}_${Math.floor(lon / deg) * deg}`;

/**
 * Split one line into per-tile runs. A run continues while consecutive points
 * share a tile; on a crossing, the previous point starts the next run so the
 * two runs overlap by a segment and the drawn coastline has no gaps at tile
 * seams — cheaper and more robust than computing boundary intersections.
 */
function splitByTile(points, deg, sink) {
  if (points.length === 0) return;
  let key = tileKey(points[0][1], points[0][0], deg);
  let run = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const k = tileKey(p[1], p[0], deg);
    run.push(p);
    if (k !== key) {
      if (run.length >= 2) (sink[key] ??= []).push(run);
      key = k;
      run = [points[i - 1], p];
    }
  }
  if (run.length >= 2) (sink[key] ??= []).push(run);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`Building coastline tiles (tolerance ${args.tolerance} deg)\n`);
  if (args.cache) await mkdir(args.cache, { recursive: true });

  const byTile = {};
  let rawPoints = 0;
  let keptPoints = 0;

  for (const layer of LAYERS) {
    const geojson = await loadLayer(layer, args.cache);
    for (const feature of geojson.features) {
      for (const line of linesOf(feature.geometry)) {
        rawPoints += line.length;
        const simplified = simplify(line, args.tolerance);
        keptPoints += simplified.length;
        splitByTile(simplified, args.tileDeg, byTile);
      }
    }
  }

  // Rebuild from scratch so a retuned tolerance cannot leave orphan tiles behind.
  if (existsSync(args.out)) {
    for (const f of await readdir(args.out)) {
      if (f.endsWith('.json')) await rm(join(args.out, f));
    }
  }
  await mkdir(args.out, { recursive: true });

  const round = (n) => Math.round(n * 1000) / 1000;
  const keys = Object.keys(byTile).sort();
  let bytes = 0;
  for (const key of keys) {
    const lines = byTile[key].map((run) => run.flatMap(([lon, lat]) => [round(lon), round(lat)]));
    const json = JSON.stringify({ lines });
    bytes += json.length;
    await writeFile(join(args.out, `${key}.json`), json);
  }

  const index = JSON.stringify({ tileDeg: args.tileDeg, tiles: keys });
  bytes += index.length;
  await writeFile(join(args.out, 'index.json'), index);

  process.stdout.write(
    `\n  points ${rawPoints} -> ${keptPoints} (${((1 - keptPoints / rawPoints) * 100).toFixed(1)}% dropped)\n` +
      `  tiles  ${keys.length}\n` +
      `  size   ${(bytes / 1e6).toFixed(2)} MB\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`build-coastline failed: ${err.message}\n`);
  process.exit(1);
});
