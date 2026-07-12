# ✈️ FlightWall

A live departure-board wall display of the aircraft directly overhead.
Built for a Samsung Frame TV; works in any browser.

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
