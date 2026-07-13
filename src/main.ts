import './styles.css';
import { loadConfig } from './config';
import { computeStageTransform } from './stage';
import { AirplanesLiveProvider } from './api/positions';
import { AdsbdbRoutes } from './api/routes';
import { HexdbRoutes, HexdbAirports } from './api/hexdb';
import { AircraftInfo } from './api/aircraft';
import { PlanespottersPhotos } from './api/photos';
import { isRoutePlausible } from './routecheck';
import { PollLoop, type Snapshot } from './state';
import { Board, type RowExtras } from './ui/board';
import { renderSettings } from './ui/settings';
import { armButton } from './ui/armed';
import { performReset } from './reset';
import { tvInit } from './tizen';
import type { Aircraft, Route, Photo } from './types';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

let docMode = false;

// TV webviews can report one viewport at startup and settle on another
// without firing resize — measure the real visible area and re-fit late.
function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  return vv && vv.width > 0
    ? { w: vv.width, h: vv.height }
    : { w: window.innerWidth, h: window.innerHeight };
}

function fitToScreen(): void {
  if (docMode) return;
  const { w, h } = viewportSize();
  app!.style.transform = computeStageTransform(w, h).transform;
}
window.addEventListener('resize', fitToScreen);
window.visualViewport?.addEventListener('resize', fitToScreen);
fitToScreen();
for (const ms of [300, 1000, 3000]) setTimeout(fitToScreen, ms);

// Settings render as a normal responsive document, not on the scaled stage.
function enterDocMode(): void {
  docMode = true;
  app!.style.transform = ''; // the inline stage transform would beat the class rule
  document.body.classList.add('doc-mode');
}

// Reconfigure when the hash changes (e.g. new link opened on the TV).
window.addEventListener('hashchange', () => location.reload());

// TV remote (and keyboard): OK/Enter on the board opens settings; BACK/Return
// (Tizen keyCode 10009) inside settings goes back to the board. On the board,
// BACK keeps its default behavior (exits the app).
const TIZEN_BACK = 10009;
let openSettingsFromRemote: (() => void) | null = null;
document.addEventListener('keydown', (e) => {
  if (docMode) {
    if (e.keyCode === TIZEN_BACK) {
      e.preventDefault();
      location.reload();
    }
    return;
  }
  if (e.key === 'Enter' && openSettingsFromRemote) {
    e.preventDefault();
    openSettingsFromRemote();
  }
});

tvInit();

// PWA: cache the shell for instant starts; APIs are never cached. Skipped in
// the packaged Tizen app (non-http origin) and in dev (the SW's cache-first
// asset strategy would serve stale Vite modules across edits).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // registration is best-effort; the app is fully functional without it
    });
  });
}

const config = loadConfig(location.hash, localStorage);

if (!config) {
  enterDocMode();
  renderSettings(app, {}, location.href);
} else {
  // Installed-PWA nicety (Android honors it; iOS has no lock API): try to pin
  // landscape. Harmless rejection everywhere else.
  try {
    const orientation = screen.orientation as unknown as {
      lock?: (o: string) => Promise<void>;
    };
    orientation.lock?.('landscape').catch(() => {});
  } catch {
    // no orientation API — fine
  }
  const board = new Board(app, config);

  let settingsOpen = false;
  const gearBtn = document.createElement('button');
  gearBtn.className = 'gear-btn';
  gearBtn.textContent = '⚙';
  gearBtn.setAttribute('aria-label', 'Settings');
  const openSettings = (): void => {
    settingsOpen = true;
    loop.stop();
    enterDocMode();
    renderSettings(app, config, location.href);
  };
  gearBtn.addEventListener('click', openSettings);
  openSettingsFromRemote = openSettings;
  app.appendChild(gearBtn);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'board-reset-btn';
  resetBtn.textContent = '↺';
  resetBtn.setAttribute('aria-label', 'Reset FlightWall');
  armButton(resetBtn, { armedLabel: 'RESET?', onConfirm: performReset });
  app.appendChild(resetBtn);

  const routesClient = new AdsbdbRoutes(localStorage);
  const hexRoutesClient = new HexdbRoutes(localStorage);
  const airportsClient = new HexdbAirports(localStorage);
  const aircraftClient = new AircraftInfo(localStorage);
  const photosClient = new PlanespottersPhotos(localStorage);
  const routes = new Map<string, Route | null>();
  const routePending = new Set<string>();
  const routeRetryAt = new Map<string, number>();
  const operators = new Map<string, string | null>();
  const opPending = new Set<string>();
  const opRetryAt = new Map<string, number>();
  let lastSnapshot: Snapshot | null = null;

  // Route as displayed for one aircraft: cached route gated by the corridor
  // plausibility check against the aircraft's current position.
  function plausibleRouteFor(a: Aircraft): Route | null {
    const r = a.callsign ? routes.get(a.callsign) ?? null : null;
    return r && isRoutePlausible(r, a) ? r : null;
  }

  function buildExtras(snap: Snapshot): Map<string, RowExtras> {
    const extras = new Map<string, RowExtras>();
    for (const a of snap.aircraft) {
      extras.set(a.hex, {
        route: plausibleRouteFor(a),
        operator: operators.get(a.hex) ?? null,
      });
    }
    return extras;
  }

  function rerender(): void {
    if (!lastSnapshot) return;
    board.update(lastSnapshot, buildExtras(lastSnapshot));
    updateSpotlight(lastSnapshot);
  }

  // adsbdb first; on a definitive miss, hexdb's callsign→ICAO-pair as second
  // source, resolved to coordinates so the plausibility gate applies to it too.
  async function resolveRoute(cs: string): Promise<void> {
    const primary = await routesClient.getRoute(cs);
    if (primary === undefined) {
      routeRetryAt.set(cs, Date.now() + 60_000);
      return;
    }
    if (primary !== null) {
      routes.set(cs, primary);
      return;
    }
    const pair = await hexRoutesClient.getRoutePair(cs);
    if (pair === undefined) {
      routeRetryAt.set(cs, Date.now() + 60_000);
      return;
    }
    if (pair === null) {
      routes.set(cs, null);
      return;
    }
    const [origin, dest] = await Promise.all([
      airportsClient.getAirport(pair.originIcao),
      airportsClient.getAirport(pair.destIcao),
    ]);
    if (origin === undefined || dest === undefined) {
      routeRetryAt.set(cs, Date.now() + 60_000);
      return;
    }
    if (!origin || !dest) {
      routes.set(cs, null);
      return;
    }
    routes.set(cs, {
      airlineName: null,
      originCode: origin.iata ?? origin.icao,
      originCity: null,
      originLat: origin.lat,
      originLon: origin.lon,
      destCode: dest.iata ?? dest.icao,
      destCity: null,
      destLat: dest.lat,
      destLon: dest.lon,
    });
  }

  const loop = new PollLoop({
    provider: new AirplanesLiveProvider(),
    config,
    isHidden: () => document.hidden,
    onUpdate: (snap) => {
      lastSnapshot = snap;
      board.update(snap, buildExtras(snap));
      updateSpotlight(snap);
      const now = Date.now();
      for (const a of snap.aircraft) {
        const cs = a.callsign;
        if (cs && !routes.has(cs) && !routePending.has(cs) && (routeRetryAt.get(cs) ?? 0) <= now) {
          routePending.add(cs);
          void resolveRoute(cs).then(() => {
            routePending.delete(cs);
            rerender();
          });
        }
        // Operator fallback: once the route question is settled (or there is
        // no callsign to ask about) and it yielded no airline, ask the registry.
        const routeSettled = cs ? routes.has(cs) : true;
        const hasAirline = cs ? Boolean(routes.get(cs)?.airlineName) : false;
        if (
          routeSettled && !hasAirline &&
          !operators.has(a.hex) && !opPending.has(a.hex) &&
          (opRetryAt.get(a.hex) ?? 0) <= now
        ) {
          opPending.add(a.hex);
          void aircraftClient.getOperator(a.hex).then((op) => {
            opPending.delete(a.hex);
            if (op === undefined) {
              opRetryAt.set(a.hex, Date.now() + 60_000);
              return;
            }
            operators.set(a.hex, op);
            rerender();
          });
        }
      }
    },
  });

  let spotlightHex: string | null = null;
  let spotlightPhoto: Photo | null = null;
  let spotlightRendered = '';
  function updateSpotlight(snap: Snapshot): void {
    const nearest = snap.aircraft.length > 0 ? snap.aircraft[0]! : null;
    if (!nearest) {
      spotlightHex = null;
      spotlightPhoto = null;
      spotlightRendered = '';
      board.setSpotlight(null, null, null);
      return;
    }
    if (nearest.hex === spotlightHex) {
      const route = plausibleRouteFor(nearest);
      const operator = operators.get(nearest.hex) ?? null;
      const key = nearest.hex + '|' + (spotlightPhoto?.thumbnailUrl ?? '') + '|' + JSON.stringify(route ?? null) + '|' + (operator ?? '');
      if (key === spotlightRendered) return;
      spotlightRendered = key;
      board.setSpotlight(nearest, route, spotlightPhoto, operator);
      return;
    }
    spotlightHex = nearest.hex;
    spotlightPhoto = null;
    void photosClient.getPhoto(nearest.hex).then((photo) => {
      if (spotlightHex !== nearest.hex) return; // superseded meanwhile
      spotlightPhoto = photo;
      const route = plausibleRouteFor(nearest);
      const operator = operators.get(nearest.hex) ?? null;
      const key = nearest.hex + '|' + (photo?.thumbnailUrl ?? '') + '|' + JSON.stringify(route ?? null) + '|' + (operator ?? '');
      spotlightRendered = key;
      board.setSpotlight(nearest, route, photo, operator);
    });
  }

  loop.start();

  const bootAt = Date.now();

  // 1 Hz clock + staleness repaint
  setInterval(() => {
    if (settingsOpen) return;
    board.tickClock(Date.now(), lastSnapshot?.lastSuccessAt ?? bootAt);
  }, 1000);

  // Stall watchdog: if no tick for 90 s while visible, restart the loop.
  // A due tick is one the loop itself scheduled — backoff waits are not stalls,
  // and a loop stopped for the settings screen must stay stopped.
  setInterval(() => {
    if (settingsOpen) return;
    if (!document.hidden && Date.now() - Math.max(loop.lastTickAt, loop.nextTickDueAt) > 90_000) {
      loop.stop();
      loop.start();
    }
  }, 30_000);

  // Daily maintenance reload at 04:00 local (TV runtimes leak).
  const now = new Date();
  const next4am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4, 0, 0);
  if (next4am.getTime() <= now.getTime()) next4am.setDate(next4am.getDate() + 1);
  setTimeout(() => location.reload(), next4am.getTime() - now.getTime());
}
