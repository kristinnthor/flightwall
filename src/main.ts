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
  let spotlightPhoto: Photo | null = null;
  function updateSpotlight(snap: Snapshot): void {
    const nearest = snap.aircraft.length > 0 ? snap.aircraft[0]! : null;
    if (!nearest) {
      spotlightHex = null;
      spotlightPhoto = null;
      board.setSpotlight(null, null, null);
      return;
    }
    if (nearest.hex === spotlightHex) {
      board.setSpotlight(nearest, nearest.callsign ? routes.get(nearest.callsign) ?? null : null, spotlightPhoto);
      return;
    }
    spotlightHex = nearest.hex;
    spotlightPhoto = null;
    void photosClient.getPhoto(nearest.hex).then((photo) => {
      if (spotlightHex !== nearest.hex) return; // superseded meanwhile
      spotlightPhoto = photo;
      const route = nearest.callsign ? routes.get(nearest.callsign) ?? null : null;
      board.setSpotlight(nearest, route, photo);
    });
  }

  loop.start();

  const bootAt = Date.now();

  // 1 Hz clock + staleness repaint
  setInterval(() => {
    board.tickClock(Date.now(), lastSnapshot?.lastSuccessAt ?? bootAt);
  }, 1000);

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
}
