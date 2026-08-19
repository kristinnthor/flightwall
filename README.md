# ✈️ FlightWall

A live departure-board wall display of the aircraft directly overhead.
Built for a Samsung Frame TV; works in any browser and installs as a PWA
on phones and tablets.

## Quick start

Open the hosted app and configure your location:
**https://kristinnthor.github.io/flightwall/**

The settings screen builds a personal URL like:

```
https://kristinnthor.github.io/flightwall/#lat=64.14&lon=-21.94&r=50&label=HOME&t=60
```

Open that URL anywhere — phone, laptop, TV browser — and the wall starts.
Config lives only in the URL and your browser (never on a server). On the
board, the ⚙ gear (or OK on a TV remote) reopens settings; RESET wipes the
saved config and starts over.

| Parameter | Meaning |
|---|---|
| `lat`, `lon` | Home point the wall watches from |
| `r` | Radius in km (1–460) |
| `label` | Name shown in the header (optional) |
| `t` | Minutes of flight path drawn on the map (0–180, default 60; `0` shows positions with no trail) |
| `api` | Pin the aircraft feed to one source instead of trying the built-in list (see below) |

### Choosing a data feed

**The community ADS-B networks do not allow browser access.** Measured from the
deployed wall:

| Feed | Result |
|---|---|
| airplanes.live | `403` — restricted to feeders |
| adsb.one | `403` |
| adsb.lol | connection refused |
| adsb.fi | **`200` with data, but no `Access-Control-Allow-Origin`** |

adsb.fi has the data and returns it; the browser discards it because the
response carries no CORS header. These are server-side APIs, so a static page
cannot read them directly no matter which URL it uses.

The fix is the small Cloudflare Worker in `worker/` — it forwards FlightWall's
one query to adsb.fi and adds the header:

```
cd worker && npx wrangler deploy
```

Then point the wall at it with `api`, which takes a URL template using `{lat}`,
`{lon}` and `{nm}` (nautical miles):

```
#lat=64.14&lon=-21.94&r=100&api=https://flightwall-proxy.<you>.workers.dev/v2/lat/{lat}/lon/{lon}/dist/{nm}
```

At the 5 s poll rate that is ~17k requests/day, inside Cloudflare's free tier.
The worker caches for 4 s so several viewers cannot breach adsb.fi's limit of
one request per second.

The worker is **not** an open proxy: it accepts only this one path shape,
forwards only to adsb.fi, and refuses origins outside `ALLOWED_ORIGINS` in
`worker/wrangler.toml`. Change that variable if you serve the wall elsewhere.

Setting `api` pins the feed to exactly that source with no failover, which is
what you want when testing whether something works. A bare base URL keeps the
older `/point/{lat}/{lon}/{nm}` layout. Aircraft arrays named `ac` or
`aircraft` are both understood.

## Board and map

Two views of the same sky. The board is the departure-board table; the map is
a radar scope — home at the centre, range rings, coastline, and each
aircraft's path over the last `t` minutes. Switch with the MAP/BOARD button,
or left/right on a TV remote. The choice is remembered.

Trails build up while the wall is running: the data source only reports
aircraft currently in radius, so there is no history to backfill. A
freshly-started wall shows an empty scope that fills in over the following
hour.

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
  Currently feeder-only, so the wall reaches [adsb.fi](https://adsb.fi) through the
  proxy in `worker/` instead — see "Choosing a data feed". The footer credits
  whichever source is actually serving data.
- Routes, airlines & aircraft operators: [adsbdb.com](https://www.adsbdb.com), with
  [hexdb.io](https://hexdb.io) as fallback for routes, airports, and operators.
- Photos: [planespotters.net](https://www.planespotters.net) — photos remain theirs,
  credited and linked in the UI as required.
- Coastline & lakes: [Natural Earth](https://www.naturalearthdata.com) 1:50m physical
  vectors, public domain. Bundled offline under `public/coast/` so the map view needs
  no tile server; regenerate with `node scripts/build-coastline.mjs`.

Routes are best-effort: they come from callsign databases, and FlightWall only shows
a route when the aircraft's live position is plausibly on that route's corridor —
otherwise it shows a dash rather than a wrong answer.

Not for operational/navigational use.
