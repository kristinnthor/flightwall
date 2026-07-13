# FlightWall — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design approved in brainstorming session; spec pending user review)
**Repo:** `kristinnthor/flightwall` (public, MIT)

## 1. Overview

FlightWall is a full-screen, wall-display web app that shows every airborne aircraft
within a configurable radius (km) of a home location, ordered nearest-first, styled as a
classic airport departure board. It is built for a Samsung Frame TV (2022+, Tizen 6.5+)
and any regular browser. It refreshes every 5 seconds, needs no interaction after setup,
and runs with zero servers, zero API keys, and zero runtime dependencies.

Primary user: a flight-industry professional who wants to know exactly what is flying
overhead at home.

## 2. Decisions log

| Decision | Choice |
|---|---|
| Display target | Wall display (TV), glanceable from across the room |
| Visual style | Departure board (dark, amber monospace, split-flap flavor) |
| Hosting | GitHub Pages (static), auto-deploy via GitHub Actions |
| Repo | Public, `kristinnthor/flightwall`, MIT |
| Architecture | A: pure static app, single position source behind a swappable interface |
| TV integration | Full Tizen `.wgt` app in v1 (sideloaded), browser URL also works |
| TV baseline | 2022+ Frame → Tizen 6.5 → Chromium M85 build target |
| Units | Altitude ft, speed kt, distance km, bearings as compass points |

## 3. Data sources (verified 2026-07-12, live header tests + docs)

### Positions — airplanes.live (primary, only browser-callable free source)
- `GET https://api.airplanes.live/v2/point/{lat}/{lon}/{radius_nm}` — radius in **nautical
  miles**, max 250. Convert: `nm = km / 1.852`.
- No auth. Rate limit **1 req/s** (we poll every 5 s). CORS `Access-Control-Allow-Origin: *`
  (verified). Terms: non-commercial, no SLA — matches this project.
- Response: ADSBx-v2 shape `{ac: [...], now, total}`. Radius queries include `dst`
  (distance from point, **nm**) and `dir` (bearing from point).
- Normalization quirks that MUST be handled:
  - `flight` (callsign) is 8 chars padded with trailing spaces — trim.
  - `alt_baro` is feet **or the literal string `"ground"`** — type-check; ground targets
    are excluded from the board.
  - Targets with `type: "mode_s"` or without `lat`/`lon` have no usable position — exclude.
  - `hex` starting with `~` = non-ICAO (TIS-B); `r`/`t` may be absent — display "—".
  - Aircraft age out of the feed ~60 s after last position.
- Swappability: provider hidden behind an `AircraftProvider` interface. Fallback options
  (adsb.lol, adsb.fi) have no CORS today and would need a proxy — explicitly out of scope
  for v1, the interface is the seam for later. (Inside the packaged Tizen app CORS does
  not apply, but the web build is the compatibility baseline.)

### Routes & airline — adsbdb.com
- `GET https://api.adsbdb.com/v0/callsign/{CALLSIGN}` → airline (name/ICAO/IATA) + origin
  and destination airports (name, IATA/ICAO, municipality, lat/lon). CORS `*` (verified),
  no auth, no observed throttling — cache anyway.
- Best-effort: charters/GA/repositioning flights 404 or return wrong routes (callsign-keyed
  heuristic). 404s are cached as negative results. Route display is decoration, never
  blocks the board.
- Optional detail: `GET /v0/aircraft/{hex}` for operator/type description if `t`/`r`
  missing from the feed.

### Photos — planespotters.net (optional enhancement)
- `GET https://api.planespotters.net/pub/photos/hex/{hex}` → 0..1 photo with `thumbnail_large`,
  `photographer`, `link`. CORS-open for real browser pages; rejects CLI/server clients
  (verified 403 via curl — this is expected and fine).
- Hard conditions (from their ToU, all honored in the UI): visible photographer credit
  next to the image; thumbnail wrapped in a plain link (no `rel="nofollow"`) to the
  returned `link`; images loaded only from returned URLs, never re-hosted; JSON cacheable
  ≤ 24 h.
- Failure mode: spotlight strip simply hides. Must be verified on the deployed origin
  (does not work from `file://` or localhost reliably).

### Rejected sources (for the record)
OpenSky (CORS locked to own origin; 400–4,000 credits/day ≈ dead in an hour at 5 s
polling), ADSBexchange (paid RapidAPI only), FlightAware AeroAPI / FR24 (metered
commercial), adsb.lol / adsb.fi (no CORS today; proxy-only → future fallback candidates).

## 4. Product spec

### 4.1 Configuration
- Source of truth: URL hash — `#lat=64.14&lon=-21.94&r=50&label=HOME`.
  - `lat`, `lon`: decimal degrees. `r`: radius in km (1–460; 460 km ≈ the 250 nm API cap).
    `label`: optional display name shown in the header.
- Settings screen (shown when config is missing/invalid, reachable via a small gear
  hotspot): form for location (lat/lon inputs + "use my location" geolocation button),
  radius slider, label; renders the resulting shareable URL and a copy button. Set up
  from a phone/PC; the TV just opens the final URL / packaged app.
- Last valid config also persists to localStorage: URL params win; localStorage is the
  fallback (covers the packaged Tizen app, which is launched without a URL).
- No coordinates are ever committed to the repo; config lives only in URL/localStorage.

### 4.2 The board
Fixed 1920×1080 composition (the TV's logical viewport), scaled to fit other windows via
CSS transform. Dark near-black background, amber (#ffb000) primary text, warm-white
secondary, bundled monospace woff2 (candidates: B612 Mono / IBM Plex Mono; final pick
during implementation with the frontend-design pass).

Layout, top to bottom:
1. **Header** — "OVERHEAD · {label}" left; radius indicator ("WITHIN 50 KM"); UTC clock
   (HH:MM:SS) + live-status dot right (green pulsing = live, amber = stale, red = signal
   lost).
2. **Column headers** — FLIGHT · AIRLINE · ROUTE · TYPE · REG · ALT FT · SPD KT · DIST KM
   · BRG.
3. **Rows** — one per airborne aircraft, sorted by distance ascending, 12 rows max
   (more → "+N MORE" tail line). Cell details:
   - FLIGHT: trimmed callsign, fallback registration, fallback hex.
   - AIRLINE: adsbdb airline name (truncated), "—" while unknown.
   - ROUTE: "KEF→JFK" IATA pair (ICAO fallback), "—" when unknown.
   - TYPE: ICAO type code (`t`). REG: registration (`r`).
   - ALT FT: integer feet + climb/descent arrow when |baro_rate| > 256 ft/min.
   - SPD KT: ground speed integer.
   - DIST KM: `dst × 1.852`, one decimal below 10 km.
   - BRG: 16-point compass from `dir` (e.g. "NNW").
   - Row enter/exit/re-sort animated with a split-flap-flavored flip (CSS only, cheap on
     TV GPUs).
4. **Spotlight strip** (bottom, optional) — nearest aircraft: photo thumbnail (linked,
   photographer credit) + one-line summary (airline, route with city names, type). Hidden
   entirely when no photo/route data.
5. **Footer** — "DATA: AIRPLANES.LIVE · ROUTES: ADSBDB · PHOTOS: PLANESPOTTERS.NET" +
   last-update age. Attribution is a terms requirement, not decoration.

### 4.3 States
- **Live**: normal operation.
- **Clear skies**: zero aircraft — big "CLEAR SKIES" line, board otherwise calm, keeps
  polling.
- **Stale** (no successful poll for 15 s): amber dot, rows dim slightly, "STALE +Ns" tag.
- **Signal lost** (60 s): red banner "SIGNAL LOST — RETRYING", last data still visible.
- **Unconfigured/invalid config**: settings screen.

## 5. Architecture

Vanilla TypeScript + Vite. No runtime dependencies. No framework. Build target
`chrome85`; `base: './'` (relative paths so one `dist/` serves GitHub Pages AND the
Tizen package). CSS constraints honored for M85: no `aspect-ratio`, `:is()`/`:has()`,
container queries, CSS nesting; grid/flex/custom properties/transforms/woff2 are safe.

Modules (each with one purpose, unit-testable, DOM-free unless stated):

| Module | Responsibility |
|---|---|
| `src/config.ts` | Parse/validate/serialize hash config; localStorage fallback |
| `src/api/positions.ts` | `AircraftProvider` interface + airplanes.live impl; normalization (trim/exclude/convert) into a clean `Aircraft` model |
| `src/api/routes.ts` | adsbdb lookups; in-memory + localStorage cache, 24 h TTL, negative caching; small concurrency limit |
| `src/api/photos.ts` | planespotters lookup for the nearest aircraft; same caching |
| `src/state.ts` | Poll scheduler (5 s tick, pause on `visibilitychange`), backoff, diffing (entered/left/updated), staleness clock, watchdogs |
| `src/format.ts` | Pure formatters: units, compass, callsign, ages |
| `src/ui/board.ts` | DOM rendering + flip animations (the only DOM-heavy module) |
| `src/ui/settings.ts` | Settings form + URL builder |
| `src/tizen.ts` | Guarded TV-only calls (`webapis.appcommon.setScreenSaver(OFF)`), no-ops elsewhere |

## 6. Data flow

Every 5 s: one `point` query → normalize → filter (airborne + positioned) → sort by
`dst` → diff against store → render. For hexes **entering** the radius only: route lookup
(by callsign) and, if it is/becomes the nearest, photo lookup — both cached, so a typical
flight costs 1–2 enrichment calls in its lifetime. Rate budget at steady state: 0.2 req/s
to airplanes.live (limit 1/s), near-zero elsewhere.

## 7. Error handling

Nobody presses F5 on a TV; every failure self-heals:
- Poll failures (network/429/5xx): exponential backoff 5→10→20→40→80→150→300 s with
  ±20 % jitter; reset on success. UI degrades Live → Stale (15 s) → Signal lost (60 s)
  while keeping last data visible.
- Enrichment failures: silent, cell shows "—", negative-cached to avoid hammering.
- Poll-loop stall watchdog (no tick for 90 s despite visible page → hard restart of the
  scheduler; if that fails, `location.reload()`).
- Daily maintenance reload at 04:00 local (TV web runtimes leak memory).
- Malformed API payloads: normalize defensively (every field optional), skip bad records,
  never throw out of the render path.

## 8. Tizen packaging & TV setup (v1 deliverable)

- `tizen/config.xml`: `tizen:profile name="tv"`, `required_version="6.5"`,
  `http://tizen.org/privilege/internet`, `<access origin="*" subdomains="true"/>`,
  landscape, context menu disabled. Plus app icon.
- `npm run package:tizen`: builds, assembles `dist/` + Tizen files, runs `tizen package
  -t wgt` → `FlightWall.wgt` (requires Tizen Studio CLI + a certificate profile; the
  script fails with actionable messages when tooling is missing).
- `docs/tv-setup.md` — step-by-step, in order: install Tizen Studio CLI on the PC;
  create Samsung certificate (free Samsung account + TV DUID; the generic Tizen
  distributor cert path is documented as fallback — note the pre-Sept-2025 default cert
  expired, current Tizen Studio required); TV Developer Mode (Apps → 12345, host PC IP);
  `sdb connect` + `tizen install`; and the **set-and-forget checklist**: Auto Power Off →
  Off, Auto Protection Time/screensaver → Off, firmware Auto Update → **Off** (updates
  are known to delete sideloaded apps), Auto Run Smart Hub + Auto Run Last App → On.
- Known constraints documented honestly: expired dev certs block reinstalls (not the
  running app); firmware updates are the main way the app disappears; power button
  toggles to Art Mode and back into the app via Auto Run Last App.
- User's hands-on parts: Samsung account/cert step and ~5 min of TV-remote settings.

## 9. Testing

- **Vitest** unit tests (pure modules): config parse/serialize round-trips + validation;
  nm/km/ft conversions; normalization quirks (padded callsign, `"ground"`, `~hex`,
  missing position, missing r/t); sort + diff (enter/leave/reorder); backoff schedule +
  jitter bounds; compass formatting; cache TTL + negative caching.
- **Integration** (Vitest + mocked fetch): poll loop happy path, failure → backoff →
  recovery, visibility pause/resume, stall watchdog.
- **CI**: GitHub Actions — typecheck + tests + build on every push; Pages deploy only on
  green main.
- **Manual verification**: browser preview during dev; planespotters photos verified on
  the deployed Pages origin; final on-TV check (board readable from across the room,
  animations smooth, survives overnight run).

## 10. Repo layout & delivery

```
flightwall/
├── src/ …               (modules above)
├── public/fonts/ …      (woff2, licensed for bundling)
├── tizen/               (config.xml, icon)
├── docs/tv-setup.md
├── docs/superpowers/specs/  (this doc, plans)
├── .github/workflows/ci-deploy.yml
├── index.html, vite.config.ts, package.json, LICENSE (MIT), README.md
```
README covers: what it is (with screenshot), quick start, config URL format, TV install
pointer, data-source attribution + terms summary (airplanes.live non-commercial etc.).

## 11. Out of scope (v1) / future ideas

- Multi-source failover via proxy (seam exists in `AircraftProvider`).
- Radar/map visualization, historical stats ("what flew over today"), alerts
  (interesting aircraft via `dbFlags`), multiple saved locations, sound.
- Contributing an ADS-B feeder (future-proofs API access; both networks encourage it).

## 11a. v1.1 additions (2026-07-13, user-approved)

- **Reset flow:** the settings screen gains a RESET button (quiet destructive style,
  right-aligned in the actions row). It clears the stored config AND the route/photo
  caches (`clearStoredConfig` in `config.ts` removes all three `flightwall.*` keys),
  strips the hash via `history.replaceState`, and reloads to the blank first-run setup.
- **Board reset hotspot:** a ↺ button next to the ⚙ gear on the board. Destructive
  actions on the board use an arm-confirm pattern (no dialogs): first click turns the
  button into a red "RESET?" for 5 s; a second click confirms (same `performReset`
  routine as the settings RESET); the timeout disarms it. Both hotspots have enlarged
  padded hit areas (the scaled stage makes bare glyphs ~10 px targets on small windows).
- **Data coverage upgrade (v1.2):** three additions to reduce "—" cells while never
  showing wrong data:
  1. *Operator fallback* — `AircraftInfo` (adsbdb `/v0/aircraft/{hex}`, hexdb aircraft as
     fallback) resolves the registered operator by hex; the AIRLINE column and spotlight
     use it whenever the route yields no airline (charters, cargo, GA).
  2. *Corridor plausibility gate* — `isRoutePlausible` (pure, `routecheck.ts`): a route
     displays only if the aircraft lies within a 1.25× detour factor (400 km absolute
     slack floor) of the origin→destination great circle. Applies to BOTH route sources;
     suppresses stale/wrong callsign-keyed routes (e.g. FRA→IVL shown while landing KEF).
     `Route` gained airport coordinates to support this.
  3. *Second route source* — hexdb `route/icao` ICAO pairs, resolved via cached hexdb
     airport lookups (30-day TTL), used only after an adsbdb definitive miss and gated by
     the same plausibility check. Fallback routes carry codes but no airline/city names.
- **PWA (v1.3):** installable on phones/tablets. `manifest.webmanifest` (fullscreen,
  `orientation: landscape`, radar-sweep icons 192/512 incl. maskable) + hand-rolled
  `sw.js` (shell cached: navigations network-first, hashed assets cache-first;
  cross-origin APIs/photos never intercepted). The board is landscape-only everywhere:
  portrait viewports render it rotated 90° (`computeStageTransform` in `stage.ts`) since
  iOS ignores manifest orientation; Android installed apps launch landscape natively
  (plus a guarded `screen.orientation.lock` attempt). Settings render in "doc mode" —
  normal responsive document flow with a device-width viewport — instead of the scaled
  stage, so the form is phone-usable. SW registration is skipped on non-http origins
  (packaged Tizen app unaffected).
- **App icon:** "radar sweep" mark — amber plane inside a radar ring with sweep wedge on
  the near-black tile. Source of truth `public/favicon.svg`; PNG renditions generated
  from the same geometry: `public/favicon-48.png` (tab fallback),
  `public/apple-touch-icon.png` (180 px full-bleed), and `tizen/icon.png` (512×423 TV
  tile, replacing the placeholder "FW" tile). `index.html` links all web icons and sets
  `theme-color`.

## 12. Risks

| Risk | Mitigation |
|---|---|
| airplanes.live outage/policy change (may require feeding later) | Provider interface seam; documented proxy fallback path; consider feeding |
| adsbdb route data wrong for charters | Presented as decoration; per-callsign, not per-schedule |
| Photos blocked off-origin | Optional strip, hides itself; verified post-deploy |
| TV firmware update removes app | Documented: auto-update off + easy reinstall script |
| Tizen cert friction on this PC | Fallback: app still fully usable via TV browser URL while cert issues are resolved |
