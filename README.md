# ✈️ FlightWall

A live departure-board wall display of the aircraft directly overhead.
Built for a Samsung Frame TV; works in any browser and installs as a PWA
on phones and tablets.

## Quick start

Open the hosted app and configure your location:
**https://kristinnthor.github.io/flightwall/**

The settings screen builds a personal URL like:

```
https://kristinnthor.github.io/flightwall/#lat=64.14&lon=-21.94&r=50&label=HOME
```

Open that URL anywhere — phone, laptop, TV browser — and the wall starts.
Config lives only in the URL and your browser (never on a server). On the
board, the ⚙ gear (or OK on a TV remote) reopens settings; RESET wipes the
saved config and starts over.

## Phones & tablets (PWA)

Add to Home Screen (Chrome: Install app · iOS Safari: Share → Add to Home
Screen) and FlightWall runs fullscreen with its own icon. The board is
landscape-only: Android launches it in landscape automatically; on iOS it
renders rotated until you turn the device.

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
- Routes, airlines & aircraft operators: [adsbdb.com](https://www.adsbdb.com), with
  [hexdb.io](https://hexdb.io) as fallback for routes, airports, and operators.
- Photos: [planespotters.net](https://www.planespotters.net) — photos remain theirs,
  credited and linked in the UI as required.

Routes are best-effort: they come from callsign databases, and FlightWall only shows
a route when the aircraft's live position is plausibly on that route's corridor —
otherwise it shows a dash rather than a wrong answer.

Not for operational/navigational use.
