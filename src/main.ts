import './styles.css';
import { loadConfig } from './config';
import { AirplanesLiveProvider } from './api/positions';
import { AdsbdbRoutes } from './api/routes';
import { PlanespottersPhotos } from './api/photos';
import { PollLoop, type Snapshot } from './state';
import { Board } from './ui/board';
import { renderSettings } from './ui/settings';
import { tvInit } from './tizen';
import type { Route, Photo } from './types';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

function fitToScreen(): void {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  app!.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
window.addEventListener('resize', fitToScreen);
fitToScreen();

// Reconfigure when the hash changes (e.g. new link opened on the TV).
window.addEventListener('hashchange', () => location.reload());

tvInit();

const config = loadConfig(location.hash, localStorage);

if (!config) {
  renderSettings(app, {}, location.href);
} else {
  const board = new Board(app, config);

  let settingsOpen = false;
  const gearBtn = document.createElement('button');
  gearBtn.className = 'gear-btn';
  gearBtn.textContent = '⚙';
  gearBtn.setAttribute('aria-label', 'Settings');
  gearBtn.addEventListener('click', () => {
    settingsOpen = true;
    loop.stop();
    renderSettings(app, config, location.href);
  });
  app.appendChild(gearBtn);

  const routesClient = new AdsbdbRoutes(localStorage);
  const photosClient = new PlanespottersPhotos(localStorage);
  const routes = new Map<string, Route | null>();
  const routePending = new Set<string>();
  const routeRetryAt = new Map<string, number>();
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
        const cs = a.callsign;
        if (
          cs &&
          !routes.has(cs) &&
          !routePending.has(cs) &&
          (routeRetryAt.get(cs) ?? 0) <= Date.now()
        ) {
          routePending.add(cs);
          void routesClient.getRoute(cs).then((r) => {
            routePending.delete(cs);
            if (r === undefined) {
              routeRetryAt.set(cs, Date.now() + 60_000);
              return;
            }
            routes.set(cs, r);
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
      const route = nearest.callsign ? routes.get(nearest.callsign) ?? null : null;
      const key = nearest.hex + '|' + (spotlightPhoto?.thumbnailUrl ?? '') + '|' + JSON.stringify(route ?? null);
      if (key === spotlightRendered) return;
      spotlightRendered = key;
      board.setSpotlight(nearest, route, spotlightPhoto);
      return;
    }
    spotlightHex = nearest.hex;
    spotlightPhoto = null;
    void photosClient.getPhoto(nearest.hex).then((photo) => {
      if (spotlightHex !== nearest.hex) return; // superseded meanwhile
      spotlightPhoto = photo;
      const route = nearest.callsign ? routes.get(nearest.callsign) ?? null : null;
      const key = nearest.hex + '|' + (photo?.thumbnailUrl ?? '') + '|' + JSON.stringify(route ?? null);
      spotlightRendered = key;
      board.setSpotlight(nearest, route, photo);
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
