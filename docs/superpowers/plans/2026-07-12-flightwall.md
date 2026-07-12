# FlightWall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static departure-board web app showing airborne aircraft within R km of a home point, deployed to GitHub Pages and packaged as a Tizen `.wgt` for a 2022+ Samsung Frame TV.

**Architecture:** Vanilla TypeScript + Vite, zero runtime dependencies. One poll loop hits airplanes.live every 5 s, normalizes into a clean `Aircraft` model, diffs, and renders a fixed 1920×1080 board scaled to fit. Enrichment (adsbdb routes, planespotters photos) is cached and best-effort. Same `dist/` serves GitHub Pages and the Tizen package.

**Tech Stack:** TypeScript, Vite, Vitest (+happy-dom), GitHub Actions/Pages, Tizen Studio CLI (packaging only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-flightwall-design.md` — it is the authority on behavior.
- Build target `chrome85` (2022 Frame TV). Vite transpiles syntax but does NOT polyfill: never use `Array.prototype.at`, `Object.hasOwn`, `structuredClone`, `Error.cause` in `src/`. CSS: no `aspect-ratio`, `:is()`, `:has()`, container queries, CSS nesting. Grid/flex/custom properties/transforms/`gap` are fine.
- Zero runtime npm dependencies. devDependencies only.
- `vite.config.ts` must keep `base: './'` (relative paths — required for Tizen packaging).
- Fixed 1920×1080 composition; scale-to-fit via CSS transform set from JS.
- All network calls are HTTPS, self-healing, and never throw out of the render path.
- localStorage keys: `flightwall.config`, `flightwall.routes.v1`, `flightwall.photos.v1`.
- Radius: km in UI/config (1–460), converted to nm (`km / 1.852`), capped 250 nm.
- Every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Run all commands from repo root `C:\repo\flightwall`. PowerShell 5.1: chain with `;`, never `&&`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/types.ts`, `src/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `test`, `typecheck`; `src/types.ts` exports `Config`, `Aircraft`, `Route`, `Photo` used by every later task.

- [ ] **Step 1: Write config files and stubs**

`package.json`:
```json
{
  "name": "flightwall",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "happy-dom": "^15.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'chrome85' },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
```
Note: `test` key is picked up by Vitest; TS may warn it's not a Vite option — if `typecheck` complains, change the import to `import { defineConfig } from 'vitest/config';` (preferred).

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920" />
    <title>FlightWall</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`src/types.ts`:
```ts
export interface Config {
  lat: number;
  lon: number;
  radiusKm: number;
  label?: string;
}

/** Normalized airborne aircraft (ground/positionless targets are filtered out upstream). */
export interface Aircraft {
  hex: string;
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  altitudeFt: number;
  groundSpeedKt: number | null;
  verticalRateFpm: number | null;
  distanceKm: number;
  bearingDeg: number;
  lat: number;
  lon: number;
}

export interface Route {
  airlineName: string | null;
  originCode: string | null;
  originCity: string | null;
  destCode: string | null;
  destCity: string | null;
}

export interface Photo {
  thumbnailUrl: string;
  pageLink: string;
  photographer: string;
}
```

`src/main.ts`:
```ts
const app = document.getElementById('app');
if (app) app.textContent = 'FLIGHTWALL';
```

`src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests with DOM available', () => {
    const el = document.createElement('div');
    el.textContent = 'ok';
    expect(el.textContent).toBe('ok');
  });
});
```

- [ ] **Step 2: Install and verify**

Run: `npm install`
Run: `npm run typecheck` — Expected: exit 0 (if the `test` key errors, switch to `vitest/config` import as noted).
Run: `npm test -- --run` — Expected: 1 passed.
Run: `npm run build` — Expected: `dist/` produced without errors.

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "chore: scaffold Vite + TypeScript + Vitest project

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Config parsing (`src/config.ts`)

**Files:**
- Create: `src/config.ts`, `src/config.test.ts`

**Interfaces:**
- Consumes: `Config` from `src/types.ts`.
- Produces:
  - `parseHash(hash: string): Config | null`
  - `serializeToHash(cfg: Config): string` (returns `#lat=…&lon=…&r=…[&label=…]`)
  - `isValidConfig(c: unknown): c is Config`
  - `loadConfig(hash: string, storage: Storage): Config | null` — hash wins, else stored; persists valid hash config to storage.

- [ ] **Step 1: Write the failing tests**

`src/config.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { parseHash, serializeToHash, isValidConfig, loadConfig } from './config';

describe('parseHash', () => {
  it('parses a full hash', () => {
    expect(parseHash('#lat=64.14&lon=-21.94&r=50&label=HOME')).toEqual({
      lat: 64.14, lon: -21.94, radiusKm: 50, label: 'HOME',
    });
  });
  it('parses without label', () => {
    expect(parseHash('#lat=51.5&lon=0&r=30')).toEqual({ lat: 51.5, lon: 0, radiusKm: 30 });
  });
  it.each([
    ['', null], ['#', null],
    ['#lat=64&lon=-21', null],                 // missing r
    ['#lat=abc&lon=-21&r=50', null],           // NaN
    ['#lat=91&lon=0&r=50', null],              // lat out of range
    ['#lat=0&lon=181&r=50', null],             // lon out of range
    ['#lat=0&lon=0&r=0', null],                // r below 1
    ['#lat=0&lon=0&r=461', null],              // r above 460
  ])('rejects %s', (hash, expected) => {
    expect(parseHash(hash)).toBe(expected);
  });
});

describe('serializeToHash', () => {
  it('round-trips', () => {
    const cfg = { lat: 64.14, lon: -21.94, radiusKm: 50, label: 'HOME KEF' };
    expect(parseHash(serializeToHash(cfg))).toEqual(cfg);
  });
  it('omits empty label', () => {
    expect(serializeToHash({ lat: 1, lon: 2, radiusKm: 3 })).toBe('#lat=1&lon=2&r=3');
  });
});

describe('loadConfig', () => {
  beforeEach(() => localStorage.clear());
  it('prefers hash and persists it', () => {
    const cfg = loadConfig('#lat=64&lon=-21&r=50', localStorage);
    expect(cfg).toEqual({ lat: 64, lon: -21, radiusKm: 50 });
    expect(loadConfig('', localStorage)).toEqual({ lat: 64, lon: -21, radiusKm: 50 });
  });
  it('returns null with no hash and no storage', () => {
    expect(loadConfig('', localStorage)).toBeNull();
  });
  it('ignores corrupt storage', () => {
    localStorage.setItem('flightwall.config', '{not json');
    expect(loadConfig('', localStorage)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/config.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Implement**

`src/config.ts`:
```ts
import type { Config } from './types';

const STORAGE_KEY = 'flightwall.config';

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
  const cfg: Record<string, unknown> = {
    lat: Number(params.get('lat')),
    lon: Number(params.get('lon')),
    radiusKm: Number(params.get('r')),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/config.test.ts` — Expected: all pass.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/config.ts src/config.test.ts; git commit -m "feat: URL-hash config with localStorage fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Formatting and geo helpers (`src/format.ts`, `src/geo.ts`)

**Files:**
- Create: `src/format.ts`, `src/format.test.ts`, `src/geo.ts`, `src/geo.test.ts`

**Interfaces:**
- Produces:
  - `NM_TO_KM = 1.852`, `nmToKm(nm: number): number`
  - `trimCallsign(raw: string | undefined): string | null`
  - `formatDistanceKm(km: number): string` — 1 decimal < 10 km, else integer
  - `formatAlt(ft: number): string` — thousands-grouped, e.g. `"36,000"`
  - `climbArrow(fpm: number | null): '↑' | '↓' | ''` — threshold |fpm| > 256
  - `compass16(deg: number): string` — e.g. `337.5 → 'NNW'`
  - `formatAgeSeconds(ms: number): string` — `"+12s"`
  - `haversineKm(lat1, lon1, lat2, lon2): number`, `initialBearingDeg(lat1, lon1, lat2, lon2): number` (0–360)

- [ ] **Step 1: Write the failing tests**

`src/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  nmToKm, trimCallsign, formatDistanceKm, formatAlt, climbArrow, compass16, formatAgeSeconds,
} from './format';

it('nmToKm', () => expect(nmToKm(10)).toBeCloseTo(18.52));

describe('trimCallsign', () => {
  it('trims padded callsign', () => expect(trimCallsign('ICE615  ')).toBe('ICE615'));
  it('null for blank/undefined', () => {
    expect(trimCallsign('        ')).toBeNull();
    expect(trimCallsign(undefined)).toBeNull();
  });
});

describe('formatDistanceKm', () => {
  it('one decimal below 10', () => expect(formatDistanceKm(3.456)).toBe('3.5'));
  it('integer at 10+', () => expect(formatDistanceKm(21.37)).toBe('21'));
});

it('formatAlt groups thousands', () => expect(formatAlt(36000)).toBe('36,000'));

describe('climbArrow', () => {
  it.each([
    [1200, '↑'], [-800, '↓'], [200, ''], [null, ''], [-256, ''],
  ] as const)('%s -> %s', (fpm, arrow) => expect(climbArrow(fpm)).toBe(arrow));
});

describe('compass16', () => {
  it.each([
    [0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'],
    [337.5, 'NNW'], [349, 'N'], [360, 'N'], [22.4, 'NNE'],
  ] as const)('%s° -> %s', (deg, pt) => expect(compass16(deg)).toBe(pt));
});

it('formatAgeSeconds', () => expect(formatAgeSeconds(12_400)).toBe('+12s'));
```

`src/geo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { haversineKm, initialBearingDeg } from './geo';

describe('haversineKm', () => {
  it('zero for same point', () => expect(haversineKm(64, -21, 64, -21)).toBe(0));
  it('KEF to RVK is ~36 km', () => {
    expect(haversineKm(63.985, -22.6056, 64.13, -21.9406)).toBeGreaterThan(34);
    expect(haversineKm(63.985, -22.6056, 64.13, -21.9406)).toBeLessThan(38);
  });
});

describe('initialBearingDeg', () => {
  it('due north is 0', () => expect(initialBearingDeg(60, 10, 61, 10)).toBeCloseTo(0, 0));
  it('due east is ~90', () => expect(initialBearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 0));
  it('result is 0..360', () => {
    const b = initialBearingDeg(60, 10, 59, 9);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/format.test.ts src/geo.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/format.ts`:
```ts
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
```

`src/geo.ts`:
```ts
const R_EARTH_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a));
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/format.test.ts src/geo.test.ts` — Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/format.ts src/format.test.ts src/geo.ts src/geo.test.ts; git commit -m "feat: formatting and geo helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Position provider (`src/api/positions.ts`)

**Files:**
- Create: `src/api/positions.ts`, `src/api/positions.test.ts`

**Interfaces:**
- Consumes: `Aircraft` from `../types`; `nmToKm`, `trimCallsign`, `NM_TO_KM` from `../format`; `haversineKm`, `initialBearingDeg` from `../geo`.
- Produces:
  - `interface AircraftProvider { fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]> }`
  - `normalizeAircraft(raw: RawV2Aircraft, center: { lat: number; lon: number }): Aircraft | null`
  - `buildPointUrl(base: string, lat: number, lon: number, radiusKm: number): string`
  - `class AirplanesLiveProvider implements AircraftProvider` (constructor `(baseUrl = 'https://api.airplanes.live/v2', timeoutMs = 10000)`)

- [ ] **Step 1: Write the failing tests**

`src/api/positions.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeAircraft, buildPointUrl, AirplanesLiveProvider } from './positions';

const CENTER = { lat: 64.13, lon: -21.94 };

const AIRBORNE = {
  hex: '4cc2b5', type: 'adsb_icao', flight: 'ICE615  ', r: 'TF-ICY', t: 'B39M',
  alt_baro: 34000, gs: 450.3, baro_rate: -64, lat: 64.5, lon: -22.1,
  dst: 12.5, dir: 271.4, seen: 0.2,
};

describe('normalizeAircraft', () => {
  it('normalizes an airborne aircraft', () => {
    expect(normalizeAircraft(AIRBORNE, CENTER)).toEqual({
      hex: '4cc2b5', callsign: 'ICE615', registration: 'TF-ICY', typeCode: 'B39M',
      altitudeFt: 34000, groundSpeedKt: 450.3, verticalRateFpm: -64,
      distanceKm: 12.5 * 1.852, bearingDeg: 271.4, lat: 64.5, lon: -22.1,
    });
  });
  it('excludes ground targets', () => {
    expect(normalizeAircraft({ ...AIRBORNE, alt_baro: 'ground' }, CENTER)).toBeNull();
  });
  it('excludes mode_s (no position)', () => {
    expect(normalizeAircraft({ ...AIRBORNE, type: 'mode_s' }, CENTER)).toBeNull();
  });
  it('excludes missing lat/lon', () => {
    const { lat: _lat, ...rest } = AIRBORNE;
    expect(normalizeAircraft(rest, CENTER)).toBeNull();
  });
  it('falls back to alt_geom when alt_baro missing', () => {
    const { alt_baro: _ab, ...rest } = AIRBORNE;
    expect(normalizeAircraft({ ...rest, alt_geom: 33500 }, CENTER)?.altitudeFt).toBe(33500);
  });
  it('excludes when no altitude at all', () => {
    const { alt_baro: _ab, ...rest } = AIRBORNE;
    expect(normalizeAircraft(rest, CENTER)).toBeNull();
  });
  it('computes distance/bearing from center when dst/dir missing', () => {
    const { dst: _d, dir: _b, ...rest } = AIRBORNE;
    const a = normalizeAircraft(rest, CENTER);
    expect(a?.distanceKm).toBeGreaterThan(40);
    expect(a?.distanceKm).toBeLessThan(45);
    expect(a?.bearingDeg).toBeGreaterThanOrEqual(0);
  });
  it('keeps TIS-B ~hex with missing r/t as nulls', () => {
    const a = normalizeAircraft(
      { hex: '~2f00a1', type: 'tisb_other', alt_baro: 3000, lat: 64.2, lon: -21.9, dst: 5, dir: 10 },
      CENTER,
    );
    expect(a).toMatchObject({ hex: '~2f00a1', callsign: null, registration: null, typeCode: null });
  });
});

describe('buildPointUrl', () => {
  it('converts km to nm, rounded up', () => {
    expect(buildPointUrl('https://x/v2', 64.13, -21.94, 50))
      .toBe('https://x/v2/point/64.13/-21.94/27'); // 50/1.852=27.0 -> ceil 28? 26.99->27
  });
  it('caps at 250 nm and floors at 1', () => {
    expect(buildPointUrl('https://x/v2', 0, 0, 460)).toBe('https://x/v2/point/0/0/250');
    expect(buildPointUrl('https://x/v2', 0, 0, 1)).toBe('https://x/v2/point/0/0/1');
  });
});

describe('AirplanesLiveProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches, normalizes, filters', async () => {
    const body = { ac: [AIRBORNE, { ...AIRBORNE, hex: 'aaa', alt_baro: 'ground' }], total: 2 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const list = await new AirplanesLiveProvider('https://x/v2').fetchAircraft(64.13, -21.94, 50);
    expect(list).toHaveLength(1);
    expect(list[0]?.hex).toBe('4cc2b5');
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    await expect(new AirplanesLiveProvider('https://x/v2').fetchAircraft(0, 0, 10))
      .rejects.toThrow('429');
  });

  it('tolerates missing ac array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"msg":"No error"}', { status: 200 })));
    await expect(new AirplanesLiveProvider('https://x/v2').fetchAircraft(0, 0, 10)).resolves.toEqual([]);
  });
});
```

Note on the first `buildPointUrl` expectation: 50 km / 1.852 = 26.998 nm → `Math.ceil` → **27**. The test comment shows the arithmetic; the expected string is `/27`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/api/positions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/api/positions.ts`:
```ts
import type { Aircraft } from '../types';
import { NM_TO_KM, nmToKm, trimCallsign } from '../format';
import { haversineKm, initialBearingDeg } from '../geo';

/** Subset of the ADSBx-v2 per-aircraft JSON we consume. Every field optional by design. */
export interface RawV2Aircraft {
  hex?: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  baro_rate?: number;
  lat?: number;
  lon?: number;
  dst?: number; // nm from query point (radius queries only)
  dir?: number; // bearing from query point
  seen?: number;
}

export interface AircraftProvider {
  fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]>;
}

export function normalizeAircraft(
  raw: RawV2Aircraft,
  center: { lat: number; lon: number },
): Aircraft | null {
  if (!raw.hex) return null;
  if (raw.type === 'mode_s') return null;
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
  if (raw.alt_baro === 'ground') return null;

  const altitudeFt =
    typeof raw.alt_baro === 'number' ? raw.alt_baro
    : typeof raw.alt_geom === 'number' ? raw.alt_geom
    : null;
  if (altitudeFt === null) return null;

  const distanceKm =
    typeof raw.dst === 'number' ? nmToKm(raw.dst)
    : haversineKm(center.lat, center.lon, raw.lat, raw.lon);
  const bearingDeg =
    typeof raw.dir === 'number' ? raw.dir
    : initialBearingDeg(center.lat, center.lon, raw.lat, raw.lon);

  return {
    hex: raw.hex,
    callsign: trimCallsign(raw.flight),
    registration: raw.r ?? null,
    typeCode: raw.t ?? null,
    altitudeFt,
    groundSpeedKt: typeof raw.gs === 'number' ? raw.gs : null,
    verticalRateFpm: typeof raw.baro_rate === 'number' ? raw.baro_rate : null,
    distanceKm,
    bearingDeg,
    lat: raw.lat,
    lon: raw.lon,
  };
}

export function buildPointUrl(base: string, lat: number, lon: number, radiusKm: number): string {
  const nm = Math.min(250, Math.max(1, Math.ceil(radiusKm / NM_TO_KM)));
  return `${base}/point/${lat}/${lon}/${nm}`;
}

export class AirplanesLiveProvider implements AircraftProvider {
  constructor(
    private baseUrl = 'https://api.airplanes.live/v2',
    private timeoutMs = 10_000,
  ) {}

  async fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<Aircraft[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(buildPointUrl(this.baseUrl, lat, lon, radiusKm), {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`positions HTTP ${res.status}`);
      const body: { ac?: RawV2Aircraft[] } = await res.json();
      const center = { lat, lon };
      const out: Aircraft[] = [];
      for (const raw of body.ac ?? []) {
        const a = normalizeAircraft(raw, center);
        if (a) out.push(a);
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/api/positions.test.ts` — Expected: all pass.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/api; git commit -m "feat: airplanes.live provider with v2 normalization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Cached enrichment clients (`src/api/routes.ts`, `src/api/photos.ts`)

**Files:**
- Create: `src/api/cache.ts`, `src/api/cache.test.ts`, `src/api/routes.ts`, `src/api/routes.test.ts`, `src/api/photos.ts`, `src/api/photos.test.ts`

**Interfaces:**
- Consumes: `Route`, `Photo` from `../types`.
- Produces:
  - `class TtlCache<T> { constructor(storageKey: string, storage: Storage | null, ttlMs: number, maxEntries: number, now?: () => number); get(key: string): T | null | undefined; set(key: string, value: T | null): void }` — `undefined` = miss; `null` = cached negative.
  - `class AdsbdbRoutes { constructor(storage: Storage | null, baseUrl?: string, now?: () => number); getRoute(callsign: string): Promise<Route | null> }` — serialized (one request at a time), never rejects.
  - `class PlanespottersPhotos { constructor(storage: Storage | null, baseUrl?: string, now?: () => number); getPhoto(hex: string): Promise<Photo | null> }` — never rejects; hex `~`-prefixed → resolves null without fetching.

- [ ] **Step 1: Write the failing cache tests**

`src/api/cache.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TtlCache } from './cache';

describe('TtlCache', () => {
  beforeEach(() => localStorage.clear());

  it('miss is undefined, negative hit is null', () => {
    const c = new TtlCache<string>('k', localStorage, 1000, 10, () => 0);
    expect(c.get('a')).toBeUndefined();
    c.set('a', null);
    expect(c.get('a')).toBeNull();
  });

  it('stores and expires by TTL', () => {
    let t = 0;
    const c = new TtlCache<string>('k', localStorage, 1000, 10, () => t);
    c.set('a', 'v');
    expect(c.get('a')).toBe('v');
    t = 1001;
    expect(c.get('a')).toBeUndefined();
  });

  it('persists to storage and reloads', () => {
    const c1 = new TtlCache<string>('k', localStorage, 1000, 10, () => 0);
    c1.set('a', 'v');
    const c2 = new TtlCache<string>('k', localStorage, 1000, 10, () => 0);
    expect(c2.get('a')).toBe('v');
  });

  it('evicts oldest beyond maxEntries', () => {
    const c = new TtlCache<number>('k', localStorage, 10_000, 2, () => 0);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('survives corrupt storage and null storage', () => {
    localStorage.setItem('k', '{corrupt');
    expect(() => new TtlCache<string>('k', localStorage, 1000, 10)).not.toThrow();
    const c = new TtlCache<string>('k', null, 1000, 10);
    c.set('a', 'v');
    expect(c.get('a')).toBe('v');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run src/api/cache.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the cache**

`src/api/cache.ts`:
```ts
interface Entry<T> {
  v: T | null;
  exp: number;
  at: number; // insertion time, for eviction order
}

/** TTL cache with negative caching, optional localStorage persistence, and size cap. */
export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private storageKey: string,
    private storage: Storage | null,
    private ttlMs: number,
    private maxEntries: number,
    private now: () => number = Date.now,
  ) {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(storageKey);
      if (raw) {
        const obj: Record<string, Entry<T>> = JSON.parse(raw);
        const t = this.now();
        for (const [k, e] of Object.entries(obj)) {
          if (e && typeof e.exp === 'number' && e.exp > t) this.map.set(k, e);
        }
      }
    } catch {
      // corrupt cache: start fresh
    }
  }

  /** undefined = miss; null = cached negative result. */
  get(key: string): T | null | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: string, value: T | null): void {
    const t = this.now();
    this.map.set(key, { v: value, exp: t + this.ttlMs, at: t });
    while (this.map.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, e] of this.map) {
        if (e.at < oldestAt) { oldestAt = e.at; oldestKey = k; }
      }
      if (oldestKey === null) break;
      this.map.delete(oldestKey);
    }
    this.persist();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const obj: Record<string, Entry<T>> = {};
      for (const [k, e] of this.map) obj[k] = e;
      this.storage.setItem(this.storageKey, JSON.stringify(obj));
    } catch {
      // quota exceeded: cache still works in memory
    }
  }
}
```

Run: `npm test -- --run src/api/cache.test.ts` — Expected: pass.

- [ ] **Step 4: Write the failing routes/photos tests**

`src/api/routes.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AdsbdbRoutes } from './routes';

const OK_BODY = {
  response: {
    flightroute: {
      callsign: 'ICE615',
      airline: { name: 'Icelandair', icao: 'ICE', iata: 'FI' },
      origin: { iata_code: 'KEF', icao_code: 'BIKF', municipality: 'Reykjavík' },
      destination: { iata_code: 'JFK', icao_code: 'KJFK', municipality: 'New York' },
    },
  },
};

describe('AdsbdbRoutes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('maps a route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(OK_BODY), { status: 200 })));
    const r = await new AdsbdbRoutes(localStorage, 'https://x/v0').getRoute('ICE615');
    expect(r).toEqual({
      airlineName: 'Icelandair',
      originCode: 'KEF', originCity: 'Reykjavík',
      destCode: 'JFK', destCity: 'New York',
    });
  });

  it('caches: second call does not fetch', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(OK_BODY), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const client = new AdsbdbRoutes(localStorage, 'https://x/v0');
    await client.getRoute('ICE615');
    await client.getRoute('ICE615');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('negative-caches 404/unknown', async () => {
    const f = vi.fn(async () => new Response('{"response":"unknown callsign"}', { status: 404 }));
    vi.stubGlobal('fetch', f);
    const client = new AdsbdbRoutes(localStorage, 'https://x/v0');
    expect(await client.getRoute('NOPE1')).toBeNull();
    expect(await client.getRoute('NOPE1')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns null on network error without caching the failure', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', f);
    const client = new AdsbdbRoutes(localStorage, 'https://x/v0');
    expect(await client.getRoute('ICE615')).toBeNull();
    expect(await client.getRoute('ICE615')).toBeNull();
    expect(f).toHaveBeenCalledTimes(2); // transient errors are retryable
  });

  it('falls back to ICAO codes when IATA missing', async () => {
    const body = JSON.parse(JSON.stringify(OK_BODY));
    delete body.response.flightroute.origin.iata_code;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const r = await new AdsbdbRoutes(localStorage, 'https://x/v0').getRoute('ICE615');
    expect(r?.originCode).toBe('BIKF');
  });
});
```

`src/api/photos.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { PlanespottersPhotos } from './photos';

const OK_BODY = {
  photos: [{
    thumbnail_large: { src: 'https://t.plnspttrs.net/x_280.jpg' },
    link: 'https://www.planespotters.net/photo/123',
    photographer: 'Jane Doe',
  }],
};

describe('PlanespottersPhotos', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('maps a photo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(OK_BODY), { status: 200 })));
    const p = await new PlanespottersPhotos(localStorage, 'https://x/pub').getPhoto('4cc2b5');
    expect(p).toEqual({
      thumbnailUrl: 'https://t.plnspttrs.net/x_280.jpg',
      pageLink: 'https://www.planespotters.net/photo/123',
      photographer: 'Jane Doe',
    });
  });

  it('empty photos → null, cached', async () => {
    const f = vi.fn(async () => new Response('{"photos":[]}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const c = new PlanespottersPhotos(localStorage, 'https://x/pub');
    expect(await c.getPhoto('4cc2b5')).toBeNull();
    expect(await c.getPhoto('4cc2b5')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('non-ICAO ~hex skips fetch entirely', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await new PlanespottersPhotos(localStorage, 'https://x/pub').getPhoto('~2f00a1')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm test -- --run src/api/routes.test.ts src/api/photos.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 6: Implement routes and photos**

`src/api/routes.ts`:
```ts
import type { Route } from '../types';
import { TtlCache } from './cache';

interface AdsbdbAirport {
  iata_code?: string;
  icao_code?: string;
  municipality?: string;
}

interface AdsbdbBody {
  response?: {
    flightroute?: {
      airline?: { name?: string };
      origin?: AdsbdbAirport;
      destination?: AdsbdbAirport;
    };
  } | string;
}

const TTL_MS = 24 * 60 * 60 * 1000;

export class AdsbdbRoutes {
  private cache: TtlCache<Route>;
  private tail: Promise<unknown> = Promise.resolve(); // serialize requests

  constructor(
    storage: Storage | null,
    private baseUrl = 'https://api.adsbdb.com/v0',
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache<Route>('flightwall.routes.v1', storage, TTL_MS, 500, now);
  }

  getRoute(callsign: string): Promise<Route | null> {
    const cached = this.cache.get(callsign);
    if (cached !== undefined) return Promise.resolve(cached);
    const result = this.tail.then(() => this.fetchRoute(callsign));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async fetchRoute(callsign: string): Promise<Route | null> {
    const cached = this.cache.get(callsign); // may have filled while queued
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`${this.baseUrl}/callsign/${encodeURIComponent(callsign)}`);
      if (res.status === 404) {
        this.cache.set(callsign, null);
        return null;
      }
      if (!res.ok) return null; // transient — do not cache
      const body: AdsbdbBody = await res.json();
      const fr = typeof body.response === 'object' ? body.response?.flightroute : undefined;
      if (!fr) {
        this.cache.set(callsign, null);
        return null;
      }
      const route: Route = {
        airlineName: fr.airline?.name ?? null,
        originCode: fr.origin?.iata_code ?? fr.origin?.icao_code ?? null,
        originCity: fr.origin?.municipality ?? null,
        destCode: fr.destination?.iata_code ?? fr.destination?.icao_code ?? null,
        destCity: fr.destination?.municipality ?? null,
      };
      this.cache.set(callsign, route);
      return route;
    } catch {
      return null; // network error — transient, not cached
    }
  }
}
```

`src/api/photos.ts`:
```ts
import type { Photo } from '../types';
import { TtlCache } from './cache';

interface PlanespottersBody {
  photos?: Array<{
    thumbnail_large?: { src?: string };
    link?: string;
    photographer?: string;
  }>;
}

const TTL_MS = 24 * 60 * 60 * 1000;

export class PlanespottersPhotos {
  private cache: TtlCache<Photo>;

  constructor(
    storage: Storage | null,
    private baseUrl = 'https://api.planespotters.net/pub',
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache<Photo>('flightwall.photos.v1', storage, TTL_MS, 200, now);
  }

  async getPhoto(hex: string): Promise<Photo | null> {
    if (hex.startsWith('~')) return null; // non-ICAO address, no DB entry
    const cached = this.cache.get(hex);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`${this.baseUrl}/photos/hex/${encodeURIComponent(hex)}`);
      if (!res.ok) return null; // includes 403 off-origin — transient, not cached
      const body: PlanespottersBody = await res.json();
      const p = (body.photos ?? [])[0];
      if (!p || !p.thumbnail_large?.src || !p.link || !p.photographer) {
        this.cache.set(hex, null);
        return null;
      }
      const photo: Photo = {
        thumbnailUrl: p.thumbnail_large.src,
        pageLink: p.link,
        photographer: p.photographer,
      };
      this.cache.set(hex, photo);
      return photo;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- --run src/api` — Expected: all pass.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 8: Commit**

```powershell
git add src/api; git commit -m "feat: cached adsbdb route and planespotters photo clients

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Poll loop, diffing, status (`src/state.ts`)

**Files:**
- Create: `src/state.ts`, `src/state.test.ts`

**Interfaces:**
- Consumes: `AircraftProvider` from `./api/positions`; `Aircraft`, `Config` from `./types`.
- Produces:
  - `interface Snapshot { aircraft: Aircraft[]; entered: Set<string>; left: Set<string>; lastSuccessAt: number }` — `aircraft` sorted by `distanceKm` ascending.
  - `backoffDelay(failures: number, baseMs?: number, random?: () => number): number`
  - `computeStatus(lastSuccessAt: number, now: number): 'live' | 'stale' | 'lost'` (15 s / 60 s thresholds)
  - `class PollLoop { constructor(opts: PollLoopOptions); start(): void; stop(): void; lastTickAt: number }` with `PollLoopOptions = { provider; config; onUpdate(snap: Snapshot): void; onError?(failures: number): void; intervalMs?: number; isHidden?(): boolean; now?(): number; random?(): number }`. While hidden, polls are skipped and rechecked every 1000 ms.

- [ ] **Step 1: Write the failing tests**

`src/state.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollLoop, backoffDelay, computeStatus, type Snapshot } from './state';
import type { Aircraft } from './types';

const CFG = { lat: 64, lon: -21, radiusKm: 50 };

function ac(hex: string, distanceKm: number): Aircraft {
  return {
    hex, callsign: hex.toUpperCase(), registration: null, typeCode: null,
    altitudeFt: 30000, groundSpeedKt: 400, verticalRateFpm: 0,
    distanceKm, bearingDeg: 0, lat: 64, lon: -21,
  };
}

describe('backoffDelay', () => {
  const noJitter = () => 0.5; // jitter factor 1.0
  it('doubles from base and caps at 300s', () => {
    expect(backoffDelay(1, 5000, noJitter)).toBe(5000);
    expect(backoffDelay(2, 5000, noJitter)).toBe(10000);
    expect(backoffDelay(7, 5000, noJitter)).toBe(300_000);
    expect(backoffDelay(20, 5000, noJitter)).toBe(300_000);
  });
  it('jitters within ±20%', () => {
    expect(backoffDelay(1, 5000, () => 0)).toBe(4000);
    expect(backoffDelay(1, 5000, () => 1)).toBe(6000);
  });
});

describe('computeStatus', () => {
  it.each([
    [0, 'live'], [14_999, 'live'], [15_000, 'stale'], [59_999, 'stale'], [60_000, 'lost'],
  ] as const)('age %s → %s', (age, status) => {
    expect(computeStatus(1_000_000, 1_000_000 + age)).toBe(status);
  });
});

describe('PollLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeLoop(fetchImpl: () => Promise<Aircraft[]>, extra: Record<string, unknown> = {}) {
    const updates: Snapshot[] = [];
    const loop = new PollLoop({
      provider: { fetchAircraft: fetchImpl },
      config: CFG,
      onUpdate: (s) => updates.push(s),
      now: () => Date.now(),
      random: () => 0.5,
      ...extra,
    });
    return { loop, updates };
  }

  it('emits sorted snapshot and diffs entered/left across ticks', async () => {
    let call = 0;
    const { loop, updates } = makeLoop(async () => {
      call++;
      return call === 1 ? [ac('b', 20), ac('a', 5)] : [ac('a', 6), ac('c', 1)];
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates[0]?.aircraft.map((a) => a.hex)).toEqual(['a', 'b']);
    expect([...updates[0]!.entered].sort()).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(updates[1]?.aircraft.map((a) => a.hex)).toEqual(['c', 'a']);
    expect([...updates[1]!.entered]).toEqual(['c']);
    expect([...updates[1]!.left]).toEqual(['b']);
    loop.stop();
  });

  it('backs off on failure and recovers', async () => {
    let call = 0;
    const { loop, updates } = makeLoop(async () => {
      call++;
      if (call <= 2) throw new Error('boom');
      return [ac('a', 5)];
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);      // call 1 fails → retry in 5s
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);   // call 2 fails → retry in 10s
    await vi.advanceTimersByTimeAsync(9999);
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);      // call 3 succeeds
    expect(updates).toHaveLength(1);
    loop.stop();
  });

  it('skips polls while hidden and resumes when visible', async () => {
    let hidden = true;
    const fetcher = vi.fn(async () => [ac('a', 5)]);
    const { loop } = makeLoop(fetcher, { isHidden: () => hidden });
    loop.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('stop() prevents further ticks', async () => {
    const fetcher = vi.fn(async () => []);
    const { loop } = makeLoop(fetcher);
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    loop.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/state.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/state.ts`:
```ts
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

  constructor(private opts: PollLoopOptions) {}

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const now = this.opts.now ?? Date.now;
    this.lastTickAt = now();
    if (this.opts.isHidden?.()) {
      this.schedule(HIDDEN_RECHECK_MS);
      return;
    }
    const { lat, lon, radiusKm } = this.opts.config;
    try {
      const list = await this.opts.provider.fetchAircraft(lat, lon, radiusKm);
      list.sort((a, b) => a.distanceKm - b.distanceKm);
      const hexes = new Set(list.map((a) => a.hex));
      const entered = new Set([...hexes].filter((h) => !this.prevHexes.has(h)));
      const left = new Set([...this.prevHexes].filter((h) => !hexes.has(h)));
      this.prevHexes = hexes;
      this.failures = 0;
      this.opts.onUpdate({ aircraft: list, entered, left, lastSuccessAt: now() });
      this.schedule(this.opts.intervalMs ?? 5_000);
    } catch {
      this.failures++;
      this.opts.onError?.(this.failures);
      this.schedule(backoffDelay(this.failures, this.opts.intervalMs ?? 5_000, this.opts.random));
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/state.test.ts` — Expected: all pass.
Run: `npm test -- --run` — Expected: full suite green.

- [ ] **Step 5: Commit**

```powershell
git add src/state.ts src/state.test.ts; git commit -m "feat: poll loop with diffing, backoff, and status computation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Board UI (`src/ui/board.ts`, `src/styles.css`, fonts)

**Files:**
- Create: `src/ui/board.ts`, `src/ui/board.test.ts`, `src/styles.css`, `public/fonts/` (B612 Mono woff2 + OFL.txt)

**Interfaces:**
- Consumes: `Snapshot`, `computeStatus` from `../state`; `Route`, `Photo`, `Aircraft`, `Config` from `../types`; formatters from `../format`.
- Produces:
  - `class Board { constructor(root: HTMLElement, config: Config); update(snap: Snapshot, routes: Map<string, Route | null>): void; setSpotlight(a: Aircraft | null, route: Route | null, photo: Photo | null): void; tickClock(now: number, lastSuccessAt: number): void }`
  - DOM contract (used by tests and main): rows carry `data-hex`; board root gets `data-status="live|stale|lost"`; empty state element has class `clear-skies`; row overflow element has class `more-line`; footer has class `attribution`.
  - Max 12 rows rendered; overflow shows `+N MORE`.

- [ ] **Step 1: Download the font (best-effort)**

```powershell
New-Item -ItemType Directory -Force public\fonts | Out-Null
curl.exe -sL -o public\fonts\b612-mono.zip "https://gwfh.mranftl.com/api/fonts/b612-mono?download=zip&subsets=latin&variants=regular,700&formats=woff2"
Expand-Archive -Force public\fonts\b612-mono.zip public\fonts; Remove-Item public\fonts\b612-mono.zip
Get-ChildItem public\fonts
```
Expected: two `.woff2` files (regular, 700). Rename them to `b612-mono-regular.woff2` and `b612-mono-700.woff2`. Add `public/fonts/OFL.txt` containing the SIL OFL 1.1 license header naming B612 Mono (copy from https://openfontlicense.org — or from the font's Google Fonts page "About & license").
**If the download fails:** skip the files; the CSS font stack falls back to `Consolas, monospace` and everything else proceeds — do not block the task.

- [ ] **Step 2: Write the failing board tests**

`src/ui/board.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from './board';
import type { Aircraft, Route } from '../types';
import type { Snapshot } from '../state';

const CFG = { lat: 64, lon: -21, radiusKm: 50, label: 'HOME' };

function ac(hex: string, distanceKm: number, over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex, callsign: `CS${hex.toUpperCase()}`, registration: 'TF-XXX', typeCode: 'B39M',
    altitudeFt: 34000, groundSpeedKt: 450, verticalRateFpm: 1200,
    distanceKm, bearingDeg: 315, lat: 64, lon: -21, ...over,
  };
}

function snap(aircraft: Aircraft[]): Snapshot {
  return { aircraft, entered: new Set(), left: new Set(), lastSuccessAt: Date.now() };
}

describe('Board', () => {
  let root: HTMLElement;
  let board: Board;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    board = new Board(root, CFG);
  });

  it('renders header label, radius, and attribution footer', () => {
    expect(root.textContent).toContain('HOME');
    expect(root.textContent).toContain('WITHIN 50 KM');
    expect(root.querySelector('.attribution')?.textContent).toContain('AIRPLANES.LIVE');
  });

  it('renders one row per aircraft in given order with data cells', () => {
    board.update(snap([ac('aaa', 3.2), ac('bbb', 12)]), new Map());
    const rows = [...root.querySelectorAll('[data-hex]')];
    expect(rows.map((r) => r.getAttribute('data-hex'))).toEqual(['aaa', 'bbb']);
    const first = rows[0]!;
    expect(first.textContent).toContain('CSAAA');
    expect(first.textContent).toContain('34,000');
    expect(first.textContent).toContain('↑');
    expect(first.textContent).toContain('3.2');
    expect(first.textContent).toContain('NW');
  });

  it('shows route when known, em-dash when not', () => {
    const routes = new Map<string, Route | null>([
      ['CSAAA', { airlineName: 'Icelandair', originCode: 'KEF', originCity: 'Reykjavík', destCode: 'JFK', destCity: 'New York' }],
    ]);
    board.update(snap([ac('aaa', 3), ac('bbb', 5)]), routes);
    const rows = [...root.querySelectorAll('[data-hex]')];
    expect(rows[0]?.textContent).toContain('KEF→JFK');
    expect(rows[0]?.textContent).toContain('ICELANDAIR');
    expect(rows[1]?.textContent).toContain('—');
  });

  it('caps at 12 rows and shows +N MORE', () => {
    const many = Array.from({ length: 15 }, (_, i) => ac(`h${i}`, i + 1));
    board.update(snap(many), new Map());
    expect(root.querySelectorAll('[data-hex]')).toHaveLength(12);
    expect(root.querySelector('.more-line')?.textContent).toContain('+3 MORE');
  });

  it('shows CLEAR SKIES when empty', () => {
    board.update(snap([]), new Map());
    expect(root.querySelector('.clear-skies')?.textContent).toContain('CLEAR SKIES');
  });

  it('tickClock sets status attribute', () => {
    const t = Date.now();
    board.tickClock(t + 20_000, t);
    expect(root.querySelector('.board')?.getAttribute('data-status')).toBe('stale');
    board.tickClock(t + 61_000, t);
    expect(root.querySelector('.board')?.getAttribute('data-status')).toBe('lost');
  });

  it('spotlight renders credited, linked photo', () => {
    board.setSpotlight(
      ac('aaa', 2),
      { airlineName: 'Icelandair', originCode: 'KEF', originCity: 'Reykjavík', destCode: 'JFK', destCity: 'New York' },
      { thumbnailUrl: 'https://t/x.jpg', pageLink: 'https://p/1', photographer: 'Jane Doe' },
    );
    const link = root.querySelector<HTMLAnchorElement>('.spotlight a');
    expect(link?.href).toBe('https://p/1');
    expect(link?.rel).not.toContain('nofollow');
    expect(root.querySelector('.spotlight img')?.getAttribute('src')).toBe('https://t/x.jpg');
    expect(root.querySelector('.spotlight')?.textContent).toContain('© Jane Doe');
  });

  it('spotlight hides without photo', () => {
    board.setSpotlight(ac('aaa', 2), null, null);
    expect(root.querySelector<HTMLElement>('.spotlight')?.hidden).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --run src/ui/board.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement the board**

`src/ui/board.ts`:
```ts
import type { Aircraft, Config, Photo, Route } from '../types';
import { computeStatus, type Snapshot } from '../state';
import { climbArrow, compass16, formatAgeSeconds, formatAlt, formatDistanceKm } from '../format';

const MAX_ROWS = 12;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Board {
  private boardEl: HTMLElement;
  private rowsEl: HTMLElement;
  private clockEl: HTMLElement;
  private ageEl: HTMLElement;
  private spotlightEl: HTMLElement;
  private rowNodes = new Map<string, HTMLElement>();

  constructor(root: HTMLElement, config: Config) {
    root.innerHTML = '';
    this.boardEl = el('div', 'board');
    this.boardEl.setAttribute('data-status', 'live');

    const header = el('header', 'header');
    const title = el('div', 'title', `OVERHEAD · ${(config.label ?? 'HOME').toUpperCase()}`);
    const radius = el('div', 'radius', `WITHIN ${Math.round(config.radiusKm)} KM`);
    this.clockEl = el('div', 'clock', '--:--:--');
    const statusWrap = el('div', 'status-wrap');
    statusWrap.appendChild(this.clockEl);
    statusWrap.appendChild(el('span', 'status-dot'));
    header.appendChild(title);
    header.appendChild(radius);
    header.appendChild(statusWrap);
    this.boardEl.appendChild(header);

    const cols = el('div', 'row row-head');
    for (const c of ['FLIGHT', 'AIRLINE', 'ROUTE', 'TYPE', 'REG', 'ALT FT', 'SPD KT', 'DIST KM', 'BRG']) {
      cols.appendChild(el('span', 'cell', c));
    }
    this.boardEl.appendChild(cols);

    this.rowsEl = el('div', 'rows');
    this.boardEl.appendChild(this.rowsEl);

    this.spotlightEl = el('div', 'spotlight');
    this.spotlightEl.hidden = true;
    this.boardEl.appendChild(this.spotlightEl);

    const footer = el('footer', 'attribution');
    footer.appendChild(el('span', undefined,
      'DATA: AIRPLANES.LIVE · ROUTES: ADSBDB · PHOTOS: PLANESPOTTERS.NET'));
    this.ageEl = el('span', 'age', '');
    footer.appendChild(this.ageEl);
    this.boardEl.appendChild(footer);

    root.appendChild(this.boardEl);
  }

  update(snap: Snapshot, routes: Map<string, Route | null>): void {
    const visible = snap.aircraft.slice(0, MAX_ROWS);
    const visibleHexes = new Set(visible.map((a) => a.hex));

    for (const [hex, node] of this.rowNodes) {
      if (!visibleHexes.has(hex)) {
        this.rowNodes.delete(hex);
        node.classList.add('row-exit');
        setTimeout(() => node.remove(), 600);
      }
    }

    this.rowsEl.querySelectorAll('.clear-skies, .more-line').forEach((n) => n.remove());

    visible.forEach((a, i) => {
      let node = this.rowNodes.get(a.hex);
      if (!node) {
        node = el('div', 'row row-enter');
        node.setAttribute('data-hex', a.hex);
        this.rowNodes.set(a.hex, node);
      }
      this.fillRow(node, a, routes);
      const current = this.rowsEl.children[i];
      if (current !== node) this.rowsEl.insertBefore(node, current ?? null);
    });

    if (visible.length === 0) {
      this.rowsEl.appendChild(el('div', 'clear-skies', 'CLEAR SKIES'));
    }
    const overflow = snap.aircraft.length - visible.length;
    if (overflow > 0) {
      this.rowsEl.appendChild(el('div', 'more-line', `+${overflow} MORE`));
    }
  }

  private fillRow(node: HTMLElement, a: Aircraft, routes: Map<string, Route | null>): void {
    const route = a.callsign ? routes.get(a.callsign) ?? null : null;
    const routeText = route?.originCode && route?.destCode
      ? `${route.originCode}→${route.destCode}` : '—';
    const cells = [
      a.callsign ?? a.registration ?? a.hex.toUpperCase(),
      (route?.airlineName ?? '—').toUpperCase(),
      routeText,
      a.typeCode ?? '—',
      a.registration ?? '—',
      `${formatAlt(a.altitudeFt)}${climbArrow(a.verticalRateFpm)}`,
      a.groundSpeedKt === null ? '—' : String(Math.round(a.groundSpeedKt)),
      formatDistanceKm(a.distanceKm),
      compass16(a.bearingDeg),
    ];
    node.innerHTML = '';
    for (const c of cells) node.appendChild(el('span', 'cell', c));
  }

  setSpotlight(a: Aircraft | null, route: Route | null, photo: Photo | null): void {
    this.spotlightEl.innerHTML = '';
    if (!a || !photo) {
      this.spotlightEl.hidden = true;
      return;
    }
    this.spotlightEl.hidden = false;
    const link = el('a');
    link.href = photo.pageLink;
    link.target = '_blank';
    const img = el('img');
    img.src = photo.thumbnailUrl;
    img.alt = a.callsign ?? a.hex;
    link.appendChild(img);
    this.spotlightEl.appendChild(link);

    const info = el('div', 'spotlight-info');
    const parts: string[] = [];
    if (route?.airlineName) parts.push(route.airlineName);
    if (route?.originCity && route?.destCity) parts.push(`${route.originCity} → ${route.destCity}`);
    if (a.typeCode) parts.push(a.typeCode);
    info.appendChild(el('div', 'spotlight-line', parts.join(' · ') || (a.callsign ?? a.hex)));
    info.appendChild(el('div', 'spotlight-credit', `© ${photo.photographer} / planespotters.net`));
    this.spotlightEl.appendChild(info);
  }

  tickClock(now: number, lastSuccessAt: number): void {
    const d = new Date(now);
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.clockEl.textContent =
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
    const status = computeStatus(lastSuccessAt, now);
    this.boardEl.setAttribute('data-status', status);
    this.ageEl.textContent = status === 'live' ? '' : `STALE ${formatAgeSeconds(now - lastSuccessAt)}`;
  }
}
```

- [ ] **Step 5: Write `src/styles.css`**

```css
/* FlightWall — departure board. Fixed 1920x1080 stage, scaled from JS.
   TV constraint (Chromium 85): no aspect-ratio, :is(), :has(), nesting. */

@font-face {
  font-family: 'B612 Mono';
  src: url('./fonts/b612-mono-regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'B612 Mono';
  src: url('./fonts/b612-mono-700.woff2') format('woff2');
  font-weight: 700;
  font-display: swap;
}

:root {
  --bg: #07080a;
  --panel: #0d0f12;
  --amber: #ffb000;
  --amber-dim: #b37c00;
  --white: #e8e2d0;
  --dim: #6b675c;
  --green: #3fbf5a;
  --red: #e0442c;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  background: var(--bg);
  overflow: hidden;
  height: 100%;
}

#app {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1920px;
  height: 1080px;
  transform-origin: center center;
  /* scale set from JS: translate(-50%,-50%) scale(s) */
}

.board {
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--white);
  font-family: 'B612 Mono', Consolas, Menlo, monospace;
  display: flex;
  flex-direction: column;
  padding: 48px 64px;
}

.header {
  display: flex;
  align-items: baseline;
  gap: 32px;
  border-bottom: 2px solid var(--amber-dim);
  padding-bottom: 20px;
}
.title { font-size: 44px; font-weight: 700; color: var(--amber); letter-spacing: 0.06em; }
.radius { font-size: 22px; color: var(--dim); letter-spacing: 0.1em; }
.status-wrap { margin-left: auto; display: flex; align-items: center; gap: 16px; }
.clock { font-size: 28px; color: var(--white); }
.status-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--green);
  animation: pulse 2s infinite;
}
[data-status='stale'] .status-dot { background: var(--amber); animation: none; }
[data-status='lost'] .status-dot { background: var(--red); animation: none; }
@keyframes pulse { 50% { opacity: 0.35; } }

.row {
  display: grid;
  grid-template-columns: 190px 320px 200px 120px 160px 170px 130px 140px 90px;
  gap: 8px;
  font-size: 26px;
  line-height: 1.0;
  padding: 14px 0;
  border-bottom: 1px solid #1a1c20;
}
.row .cell { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row-head { color: var(--dim); font-size: 18px; letter-spacing: 0.12em; border-bottom: 1px solid var(--amber-dim); }
.rows { flex: 1; overflow: hidden; margin-top: 6px; }
.rows .row { color: var(--amber); }
.rows .cell:nth-child(2), .rows .cell:nth-child(5) { color: var(--white); }
.rows .cell:nth-child(8) { font-weight: 700; }

.row-enter { animation: flap-in 0.5s ease-out; }
.row-exit { animation: flap-out 0.5s ease-in forwards; }
@keyframes flap-in { from { transform: translateY(-8px) scaleY(0.2); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes flap-out { to { transform: scaleY(0.1); opacity: 0; } }

[data-status='stale'] .rows, [data-status='lost'] .rows { opacity: 0.55; }
[data-status='lost'] .header::after {
  content: 'SIGNAL LOST — RETRYING';
  color: var(--red);
  font-size: 22px;
  letter-spacing: 0.1em;
}

.clear-skies {
  text-align: center;
  color: var(--dim);
  font-size: 56px;
  letter-spacing: 0.25em;
  padding-top: 220px;
}
.more-line { color: var(--dim); font-size: 22px; padding: 16px 0; letter-spacing: 0.1em; }

.spotlight {
  display: flex;
  gap: 24px;
  align-items: center;
  border-top: 1px solid #1a1c20;
  padding: 20px 0 0;
}
.spotlight img { height: 120px; display: block; }
.spotlight-line { font-size: 26px; color: var(--white); }
.spotlight-credit { font-size: 16px; color: var(--dim); margin-top: 8px; }
.spotlight a { color: inherit; text-decoration: none; }

.attribution {
  display: flex;
  justify-content: space-between;
  color: var(--dim);
  font-size: 15px;
  letter-spacing: 0.08em;
  padding-top: 18px;
}
.age { color: var(--amber); }
```

Import it from `src/main.ts` (next task wires main fully; for now add at top): `import './styles.css';`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run src/ui/board.test.ts` — Expected: all pass.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 7: Commit**

```powershell
git add src/ui src/styles.css src/main.ts public/fonts; git commit -m "feat: departure-board UI with flip animations and spotlight

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Settings screen, app wiring, watchdogs (`src/ui/settings.ts`, `src/main.ts`, `src/tizen.ts`)

**Files:**
- Create: `src/ui/settings.ts`, `src/ui/settings.test.ts`, `src/tizen.ts`
- Modify: `src/main.ts` (replace stub entirely)

**Interfaces:**
- Consumes: everything produced by Tasks 2–7.
- Produces:
  - `renderSettings(root: HTMLElement, initial: Partial<Config>, pageUrl: string): void` — form that live-builds the shareable URL (`buildShareUrl`) and applies config on save (sets `location.hash`, which re-boots the app via `hashchange`).
  - `buildShareUrl(pageUrl: string, cfg: Config): string` — pure, `pageUrl` without hash + `serializeToHash(cfg)`.
  - `tvInit(): void` in `src/tizen.ts` — guarded no-throw screensaver-off call.

- [ ] **Step 1: Write the failing settings tests**

`src/ui/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildShareUrl, renderSettings } from './settings';

describe('buildShareUrl', () => {
  it('joins page URL and hash', () => {
    expect(buildShareUrl('https://x.github.io/flightwall/', { lat: 64.14, lon: -21.94, radiusKm: 50, label: 'HOME' }))
      .toBe('https://x.github.io/flightwall/#lat=64.14&lon=-21.94&r=50&label=HOME');
  });
});

describe('renderSettings', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

  it('renders inputs with initial values and live URL', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50 }, 'https://x/fw/');
    expect(root.querySelector<HTMLInputElement>('input[name=lat]')?.value).toBe('64');
    expect(root.querySelector<HTMLInputElement>('input[name=r]')?.value).toBe('50');
    expect(root.querySelector('.share-url')?.textContent).toContain('#lat=64&lon=-21&r=50');
  });

  it('updates URL as inputs change and flags invalid input', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    const lat = root.querySelector<HTMLInputElement>('input[name=lat]')!;
    const lon = root.querySelector<HTMLInputElement>('input[name=lon]')!;
    const r = root.querySelector<HTMLInputElement>('input[name=r]')!;
    lat.value = '64.1'; lat.dispatchEvent(new Event('input', { bubbles: true }));
    lon.value = '-21.9'; lon.dispatchEvent(new Event('input', { bubbles: true }));
    r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.share-url')?.textContent).toContain('lat=64.1');
    r.value = '9999'; r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.share-url')?.textContent).toContain('INVALID');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/ui/settings.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement settings, tizen shim, and main wiring**

`src/ui/settings.ts`:
```ts
import type { Config } from '../types';
import { isValidConfig, serializeToHash } from '../config';

export function buildShareUrl(pageUrl: string, cfg: Config): string {
  return pageUrl.replace(/#.*$/, '') + serializeToHash(cfg);
}

export function renderSettings(root: HTMLElement, initial: Partial<Config>, pageUrl: string): void {
  root.innerHTML = `
    <div class="settings">
      <h1>FLIGHTWALL SETUP</h1>
      <label>LATITUDE <input name="lat" type="number" step="any" value="${initial.lat ?? ''}"></label>
      <label>LONGITUDE <input name="lon" type="number" step="any" value="${initial.lon ?? ''}"></label>
      <label>RADIUS KM (1–460) <input name="r" type="number" min="1" max="460" value="${initial.radiusKm ?? ''}"></label>
      <label>LABEL <input name="label" type="text" maxlength="24" value="${initial.label ?? ''}"></label>
      <button type="button" class="geo-btn">USE MY LOCATION</button>
      <div class="share-url"></div>
      <div class="settings-actions">
        <button type="button" class="copy-btn">COPY LINK</button>
        <button type="button" class="start-btn">START</button>
      </div>
      <p class="settings-hint">Open the copied link on the TV — the wall configures itself from the URL.</p>
    </div>`;

  const input = (name: string): HTMLInputElement =>
    root.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const shareEl = root.querySelector<HTMLElement>('.share-url')!;

  const currentConfig = (): Config | null => {
    const cfg: Record<string, unknown> = {
      lat: Number(input('lat').value),
      lon: Number(input('lon').value),
      radiusKm: Number(input('r').value),
    };
    if (input('label').value) cfg.label = input('label').value;
    return isValidConfig(cfg) ? cfg : null;
  };

  const refresh = (): void => {
    const cfg = currentConfig();
    shareEl.textContent = cfg ? buildShareUrl(pageUrl, cfg) : 'INVALID — check the fields above';
  };

  root.addEventListener('input', refresh);
  refresh();

  root.querySelector('.geo-btn')?.addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      input('lat').value = pos.coords.latitude.toFixed(4);
      input('lon').value = pos.coords.longitude.toFixed(4);
      refresh();
    });
  });

  root.querySelector('.copy-btn')?.addEventListener('click', () => {
    const cfg = currentConfig();
    if (cfg && navigator.clipboard) void navigator.clipboard.writeText(buildShareUrl(pageUrl, cfg));
  });

  root.querySelector('.start-btn')?.addEventListener('click', () => {
    const cfg = currentConfig();
    if (cfg) {
      location.hash = serializeToHash(cfg);
      location.reload();
    }
  });
}
```

`src/tizen.ts`:
```ts
/** Best-effort TV integration. No-ops everywhere except a packaged Tizen app. */
export function tvInit(): void {
  try {
    const w = window as unknown as {
      webapis?: { appcommon?: {
        setScreenSaver: (state: number) => void;
        AppCommonScreenSaverState: { SCREEN_SAVER_OFF: number };
      } };
    };
    const ac = w.webapis?.appcommon;
    if (ac) ac.setScreenSaver(ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
  } catch {
    // not on a TV — fine
  }
}
```

`src/main.ts` (full replacement):
```ts
import './styles.css';
import { loadConfig } from './config';
import { AirplanesLiveProvider } from './api/positions';
import { AdsbdbRoutes } from './api/routes';
import { PlanespottersPhotos } from './api/photos';
import { PollLoop, type Snapshot } from './state';
import { Board } from './ui/board';
import { renderSettings } from './ui/settings';
import { tvInit } from './tizen';
import type { Route } from './types';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

function fitToScreen(): void {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  app!.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
window.addEventListener('resize', fitToScreen);
fitToScreen();

tvInit();

const config = loadConfig(location.hash, localStorage);

if (!config) {
  renderSettings(app, {}, location.href);
} else {
  const board = new Board(app, config);
  const routesClient = new AdsbdbRoutes(localStorage);
  const photosClient = new PlanespottersPhotos(localStorage);
  const routes = new Map<string, Route | null>();
  let lastSnapshot: Snapshot | null = null;

  const loop = new PollLoop({
    provider: new AirplanesLiveProvider(),
    config,
    isHidden: () => document.hidden,
    onUpdate: (snap) => {
      lastSnapshot = snap;
      board.update(snap, routes);
      updateSpotlight(snap);
      for (const a of snap.aircraft) {
        if (a.callsign && !routes.has(a.callsign)) {
          routes.set(a.callsign, null); // placeholder prevents duplicate lookups
          void routesClient.getRoute(a.callsign).then((r) => {
            routes.set(a.callsign!, r);
            if (lastSnapshot) {
              board.update(lastSnapshot, routes);
              updateSpotlight(lastSnapshot);
            }
          });
        }
      }
    },
  });

  let spotlightHex: string | null = null;
  function updateSpotlight(snap: Snapshot): void {
    const nearest = snap.aircraft.length > 0 ? snap.aircraft[0]! : null;
    if (!nearest) {
      spotlightHex = null;
      board.setSpotlight(null, null, null);
      return;
    }
    if (nearest.hex === spotlightHex) return;
    spotlightHex = nearest.hex;
    void photosClient.getPhoto(nearest.hex).then((photo) => {
      if (spotlightHex !== nearest.hex) return; // superseded meanwhile
      const route = nearest.callsign ? routes.get(nearest.callsign) ?? null : null;
      board.setSpotlight(nearest, route, photo);
    });
  }

  loop.start();

  // 1 Hz clock + staleness repaint
  setInterval(() => {
    board.tickClock(Date.now(), lastSnapshot?.lastSuccessAt ?? bootAt);
  }, 1000);
  const bootAt = Date.now();

  // Stall watchdog: if no tick for 90 s while visible, restart the loop.
  setInterval(() => {
    if (!document.hidden && Date.now() - loop.lastTickAt > 90_000) {
      loop.stop();
      loop.start();
    }
  }, 30_000);

  // Daily maintenance reload at 04:00 local (TV runtimes leak).
  const now = new Date();
  const next4am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4, 0, 0);
  if (next4am.getTime() <= now.getTime()) next4am.setDate(next4am.getDate() + 1);
  setTimeout(() => location.reload(), next4am.getTime() - now.getTime());

  // Reconfigure when the hash changes (e.g. new link opened on the TV).
  window.addEventListener('hashchange', () => location.reload());
}
```

Add settings styles to the end of `src/styles.css`:
```css
.settings {
  color: var(--white);
  font-family: 'B612 Mono', Consolas, Menlo, monospace;
  max-width: 760px;
  margin: 120px auto;
  display: flex;
  flex-direction: column;
  gap: 22px;
  font-size: 24px;
}
.settings h1 { color: var(--amber); letter-spacing: 0.1em; }
.settings label { display: flex; justify-content: space-between; gap: 16px; color: var(--dim); }
.settings input {
  background: var(--panel); color: var(--amber); border: 1px solid var(--amber-dim);
  font: inherit; padding: 8px 12px; width: 340px;
}
.settings button {
  background: var(--amber); color: var(--bg); border: 0; font: inherit; font-weight: 700;
  padding: 12px 20px; cursor: pointer;
}
.share-url { color: var(--green); font-size: 18px; word-break: break-all; min-height: 26px; }
.settings-actions { display: flex; gap: 16px; }
.settings-hint { color: var(--dim); font-size: 17px; }
```

- [ ] **Step 4: Run all tests and typecheck**

Run: `npm test -- --run` — Expected: full suite green.
Run: `npm run typecheck` — Expected: exit 0. (Note the `bootAt` const is declared after first use inside a callback — that is legal TS/JS since the callback runs later, but if `typecheck` complains about use-before-assign, move `const bootAt = Date.now();` above the `setInterval`.)

- [ ] **Step 5: Verify the real app end-to-end in a browser**

Create `.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "flightwall", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 }
  ]
}
```
Start the preview (`preview_start` with name `flightwall`), then:
1. Open `http://localhost:5173/` → settings screen appears.
2. Navigate to `http://localhost:5173/#lat=64.13&lon=-21.94&r=100&label=HOME` → board renders; within ~5 s rows appear (Reykjavík area usually has traffic; if genuinely empty, CLEAR SKIES shows — try r=250).
3. Verify: rows sorted by DIST ascending, UTC clock ticking, routes fill in within seconds (ICE/FI callsigns resolve), attribution footer present.
4. Screenshot for the record. Check console for errors (photos may 403 on localhost — that is EXPECTED per spec; confirm the app shrugs it off with a hidden spotlight).

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: settings screen, app wiring, TV watchdogs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: CI, GitHub Pages deploy, README, LICENSE

**Files:**
- Create: `.github/workflows/ci-deploy.yml`, `README.md`, `LICENSE`

**Interfaces:**
- Consumes: npm scripts from Task 1.
- Produces: live site at `https://kristinnthor.github.io/flightwall/`.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci-deploy.yml`:
```yaml
name: ci-deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test -- --run
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Write README and LICENSE**

`LICENSE`: standard MIT text, copyright line `Copyright (c) 2026 kristinnthor`.

`README.md`:
```markdown
# ✈️ FlightWall

A live departure-board wall display of the aircraft directly overhead.
Built for a Samsung Frame TV; works in any browser.

![screenshot](docs/screenshot.png)

## Quick start

Open the hosted app and configure your location:
**https://kristinnthor.github.io/flightwall/**

The settings screen builds a personal URL like:

```
https://kristinnthor.github.io/flightwall/#lat=64.14&lon=-21.94&r=50&label=HOME
```

Open that URL anywhere — phone, laptop, TV browser — and the wall starts.
Config lives only in the URL and your browser (never on a server).

## Samsung Frame TV (real app)

See [docs/tv-setup.md](docs/tv-setup.md) for packaging the app as a Tizen
`.wgt` and sideloading it, plus the TV settings checklist that keeps it
running 24/7.

## Development

```
npm install
npm run dev        # local dev server
npm test           # vitest
npm run build      # static bundle in dist/
```

Zero runtime dependencies. Deployed to GitHub Pages by CI on every push to main.

## Data sources & attribution

- Live positions: [airplanes.live](https://airplanes.live) — community ADS-B network,
  non-commercial use. Consider [feeding](https://airplanes.live/how-to-feed/) if you can.
- Routes/airlines: [adsbdb.com](https://www.adsbdb.com)
- Photos: [planespotters.net](https://www.planespotters.net) — photos remain theirs,
  credited and linked in the UI as required.

Not for operational/navigational use.
```

(`docs/screenshot.png`: capture from the dev-server board during Task 8 Step 5 or after deploy; commit it. If not yet captured, remove the image line rather than committing a broken link.)

- [ ] **Step 3: Push and enable Pages**

```powershell
git add -A; git commit -m "ci: build, test, and deploy to GitHub Pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
gh api -X POST repos/kristinnthor/flightwall/pages -f build_type=workflow
```
If the `gh api` call returns 409 (already exists), run instead:
`gh api -X PUT repos/kristinnthor/flightwall/pages -f build_type=workflow`
Then re-run the workflow if the first run raced Pages enablement: `gh run rerun --failed` (or `gh workflow run ci-deploy`).

- [ ] **Step 4: Verify deploy**

Run: `gh run watch` (or `gh run list --limit 1`) — Expected: ci-deploy green.
Fetch: `curl.exe -s -o NUL -w "%{http_code}" https://kristinnthor.github.io/flightwall/` — Expected: `200`.
Open `https://kristinnthor.github.io/flightwall/#lat=64.13&lon=-21.94&r=100` in the preview browser: board runs against live APIs. **Check the spotlight photo now** — on the real origin planespotters should serve photos (this was impossible to verify on localhost). If a nearby aircraft has a photo, the strip must show image + `© photographer / planespotters.net` + link.

- [ ] **Step 5: Commit any README screenshot added**

```powershell
git add docs; git commit -m "docs: add screenshot"; git push
```
(Skip if nothing changed.)

---

### Task 10: Tizen packaging (`tizen/`, package script, TV guide)

**Files:**
- Create: `tizen/config.xml`, `tizen/icon.png`, `scripts/package-tizen.mjs`, `docs/tv-setup.md`
- Modify: `package.json` (add `package:tizen` script)

**Interfaces:**
- Consumes: `dist/` from `npm run build`.
- Produces: `FlightWall.wgt` (when Tizen CLI present); actionable error otherwise.

- [ ] **Step 1: Write `tizen/config.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets"
        xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://kristinnthor.github.io/flightwall"
        version="0.1.0"
        viewmodes="maximized">
  <tizen:application id="FLTWLL2026.FlightWall"
                     package="FLTWLL2026"
                     required_version="6.5"/>
  <content src="index.html"/>
  <name>FlightWall</name>
  <icon src="icon.png"/>
  <tizen:profile name="tv"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <access origin="*" subdomains="true"/>
  <tizen:setting screen-orientation="landscape"
                 context-menu="disable"
                 background-support="disable"
                 encryption="disable"
                 install-location="auto"/>
</widget>
```

- [ ] **Step 2: Generate `tizen/icon.png`** (512×423, dark bg, amber "FW ✈"):

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 512, 423
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAlias'
$g.Clear([System.Drawing.Color]::FromArgb(7, 8, 10))
$amber = [System.Drawing.Color]::FromArgb(255, 176, 0)
$font = New-Object System.Drawing.Font('Consolas', 96, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush $amber
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString("FW", $font, $brush, (New-Object System.Drawing.RectangleF 0, 0, 512, 423), $fmt)
$pen = New-Object System.Drawing.Pen $amber, 6
$g.DrawLine($pen, 60, 340, 452, 340)
$bmp.Save("$PWD\tizen\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
```
Verify: `tizen\icon.png` exists and opens as a dark tile with amber "FW".

- [ ] **Step 3: Write the package script**

`scripts/package-tizen.mjs`:
```js
// Assembles dist/ + tizen/ into build/tizen-app and runs `tizen package`.
// Requires: npm run build first; Tizen Studio CLI on PATH; an active certificate profile.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const STAGE = 'build/tizen-app';

if (!existsSync('dist/index.html')) {
  console.error('dist/ missing — run `npm run build` first.');
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync('dist', STAGE, { recursive: true });
cpSync('tizen/config.xml', `${STAGE}/config.xml`);
cpSync('tizen/icon.png', `${STAGE}/icon.png`);

const profile = process.env.TIZEN_PROFILE || 'flightwall';
try {
  execSync('tizen version', { stdio: 'pipe' });
} catch {
  console.error(
    'Tizen CLI not found on PATH.\n' +
    'Install Tizen Studio (with CLI) from https://developer.tizen.org/development/tizen-studio/download\n' +
    'then add <tizen-studio>/tools/ide/bin to PATH. See docs/tv-setup.md.',
  );
  process.exit(1);
}

console.log(`Packaging with certificate profile "${profile}"…`);
execSync(`tizen package -t wgt -s ${profile} -o . -- ${STAGE}`, { stdio: 'inherit' });
console.log('Done. Install with: tizen install -n FlightWall.wgt -t <TV_DEVICE_NAME>');
```

Add to `package.json` scripts:
```json
"package:tizen": "npm run build && node scripts/package-tizen.mjs"
```
(npm scripts run through cmd on Windows, so `&&` is fine inside package.json.)

- [ ] **Step 4: Verify script failure modes**

Run: `node scripts/package-tizen.mjs` without `dist/` → Expected: "dist/ missing" message, exit 1.
Run: `npm run package:tizen` without Tizen CLI → Expected: build succeeds, then the actionable "Tizen CLI not found" message with the download URL, exit 1.

- [ ] **Step 5: Write `docs/tv-setup.md`**

```markdown
# FlightWall on a Samsung Frame TV (2022+)

Two routes. Route 1 works in 5 minutes; Route 2 makes it a real app tile.

## Route 1 — TV browser (quick)

1. Open the Internet app on the TV.
2. Enter your configured URL (build it on the settings screen from your phone):
   `https://kristinnthor.github.io/flightwall/#lat=…&lon=…&r=…&label=…`
3. Browser menu → **Set as home page** (survives browser restarts).
4. Do the **TV settings checklist** below.

Limits: the browser shows its top bar and is the least stable surface for
24/7 use. Route 2 is better.

## Route 2 — real Tizen app (recommended)

### One-time PC setup
1. Install **Tizen Studio** (with CLI) from
   https://developer.tizen.org/development/tizen-studio/download
   During install add the **TV Extension** and **Samsung Certificate Extension**
   via Package Manager. Add `<tizen-studio>\tools\ide\bin` and
   `<tizen-studio>\tools` to PATH.
2. TV: **Apps → press 1 2 3 4 5 on the remote → Developer mode ON**, set
   *Host PC IP* to this PC's LAN IP, reboot the TV.
3. Find the TV's IP (Settings → Connection → Network → Network Status).
4. Connect: `sdb connect <TV_IP>:26101` then `sdb devices` (note the device name).
5. Certificate (Certificate Manager GUI, one time):
   - Try **Tizen** profile first (name it `flightwall`): simplest, no account.
   - If install later fails with a cert error, create a **Samsung** profile
     instead: needs a free Samsung account; the TV's DUID appears automatically
     while `sdb` is connected. Then also run:
     `tizen install-permit -t <DEVICE_NAME>`.

### Build, package, install
```powershell
npm run package:tizen        # produces FlightWall.wgt (profile: flightwall,
                             # override with $env:TIZEN_PROFILE)
tizen install -n FlightWall.wgt -t <DEVICE_NAME>
```
The app appears on the TV home row. Launch it once; done.

### Updating later
Bump `version` in `tizen/config.xml`, re-run the two commands above.
Keep the same certificate profile — updates must be signed by the same author.

## TV settings checklist (set-and-forget)

| Setting | Value | Why |
|---|---|---|
| Power and Energy Saving → Auto Power Off | **Off** | default kills the TV after 4 h idle |
| System Manager → Auto Protection Time (screensaver) | **Off** | else screensaver covers the board |
| Support → Software Update → Auto Update | **Off** | firmware updates are known to delete sideloaded apps |
| Smart Features → Auto Run Last App | **On** | power button from Art Mode drops straight back into FlightWall |

Notes:
- Power button toggles TV ↔ Art Mode; with Auto Run Last App on, one press
  brings the wall back.
- An expired dev certificate blocks *re*-installs, never the installed app.
- If a firmware update ever removes the app: re-enable Developer Mode and
  re-run the install commands.
```

- [ ] **Step 6: Full-suite check and commit**

Run: `npm test -- --run` — Expected: green.
Run: `npm run typecheck` — Expected: exit 0.

```powershell
git add -A; git commit -m "feat: Tizen packaging, icon, and Frame TV setup guide

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Hands-on TV install (with the user)**

This step needs the user physically present with the TV and takes ~20–30 min:
1. Install Tizen Studio CLI on this PC (large download — get user's go-ahead).
2. Walk `docs/tv-setup.md` Route 2 together: Developer Mode, `sdb connect`,
   certificate, `npm run package:tizen`, `tizen install`.
3. Apply the TV settings checklist.
4. Acceptance: board visible on the Frame, readable across the room, survives
   a power-button cycle (Art Mode → back), left running overnight.
If the user is not available, stop after Step 6 — the deliverable up to here
is complete and testable without the TV.

---

## Plan self-review (done at write time)

- **Spec coverage:** config/URL (T2, T8), normalization quirks (T4), enrichment + caching + negative cache (T5), poll/backoff/status/visibility (T6), board UI/states/spotlight/attribution (T7), settings + watchdogs + scale-to-fit + tizen shim (T8), CI/Pages/README/terms (T9), Tizen packaging + TV checklist (T10). Photos-on-real-origin verification: T9 Step 4. ✓
- **Placeholder scan:** none — every step has full code/commands. ✓
- **Type consistency:** `Aircraft`/`Route`/`Photo`/`Config` defined once in T1 `types.ts`; `Snapshot`/`computeStatus` in T6 consumed by T7/T8; `TtlCache` `undefined`-vs-`null` contract used consistently in T5. `buildPointUrl` exported name matches T4 tests. ✓
```
