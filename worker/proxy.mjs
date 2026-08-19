// FlightWall CORS proxy — a Cloudflare Worker.
//
// The community ADS-B feeds are built for server-side use: adsb.fi answers a
// browser request with HTTP 200 and no Access-Control-Allow-Origin, so the
// browser discards perfectly good data, and airplanes.live/adsb.one answer 403.
// This forwards the one query FlightWall makes and adds the header.
//
// Deliberately NOT an open proxy. It accepts only the ADS-B point-query path
// shape and forwards only to a fixed upstream, so it cannot be used to reach
// arbitrary hosts. Requests from origins outside ALLOWED_ORIGINS are refused.
//
//   npx wrangler deploy            # from worker/
//
// Then confirm it is live by opening the deployed host in a browser: GET /
// answers with a JSON identity card. Finally point the wall at it:
//   #...&api=https://<worker-host>/v2/lat/{lat}/lon/{lon}/dist/{nm}

const UPSTREAM = 'https://opendata.adsb.fi/api';
/** Network actually supplying the data. Sent back so the wall credits adsb.fi
 *  rather than this proxy's hostname — attribution is a terms requirement. */
const UPSTREAM_LABEL = 'ADSB.FI';

/** Short enough to stay fresh at a 5 s poll, long enough that several viewers
 *  behind one proxy cannot breach adsb.fi's 1 request/second limit. */
const CACHE_SECONDS = 4;

/** Stamped into every response this Worker produces, including the failures.
 *  Cloudflare's own "no Worker on this hostname" 404 carries no such marker,
 *  so its presence is what tells you the deploy actually landed. */
const WORKER_NAME = 'flightwall-proxy';

/** Human-readable form of what upstreamPathFor accepts, so a rejected request
 *  can show the caller the shape it failed to match. */
const PATH_SHAPE = '/{v2|v3}/lat/{lat}/lon/{lon}/dist/{nm} or /{v2|v3}/point/{lat}/{lon}/{nm}';

const COORD = '(-?\\d{1,3}(?:\\.\\d+)?)';
/** adsb.fi's own layout. */
const LAT_LON_DIST = new RegExp(`^/(v2|v3)/lat/${COORD}/lon/${COORD}/dist/(\\d{1,3})/?$`);
/**
 * airplanes.live's layout, which is also what the wall builds from a bare base
 * URL with no {lat} placeholders. Supporting it means a TV can be configured
 * by typing `https://<host>/v2` — curly braces are buried several layers deep
 * on a Samsung on-screen keyboard, and this is a URL entered with a remote.
 */
const POINT = new RegExp(`^/(v2|v3)/point/${COORD}/${COORD}/(\\d{1,3})/?$`);

/**
 * Parse an incoming path into the upstream query, or null if it is not a
 * shape we forward. This is the security boundary: anything unrecognised is
 * rejected rather than passed through. Both layouts capture in the same
 * order and resolve to the same upstream path.
 */
export function upstreamPathFor(pathname) {
  const m = LAT_LON_DIST.exec(pathname) ?? POINT.exec(pathname);
  if (!m) return null;
  const [, version, lat, lon, dist] = m;
  if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) return null;
  if (Number(dist) < 1 || Number(dist) > 250) return null; // upstream's own cap
  return `/${version}/lat/${lat}/lon/${lon}/dist/${dist}`;
}

/** Origins allowed to use this proxy. Set ALLOWED_ORIGINS (comma separated) to
 *  override; defaulting to a wildcard would make it a free CORS proxy. */
export function allowedOrigin(origin, env) {
  const configured = (env && env.ALLOWED_ORIGINS) || 'https://kristinnthor.github.io';
  const list = configured.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  return list.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Upstream-Source, X-Worker',
    'X-Upstream-Source': UPSTREAM_LABEL,
    'X-Worker': WORKER_NAME,
    'Vary': 'Origin',
  };
}

/**
 * What GET / reports. Deliberately answered before the origin check: the first
 * question after a deploy is "did this land at all?", and a proxy that refuses
 * every request without an allowed Origin cannot answer it — a browser visit,
 * which sends no Origin, is indistinguishable from a missing deploy. Nothing
 * here is privileged: it names the fixed upstream and tells callers only
 * whether their own origin is accepted, which one request would reveal anyway.
 *
 * Takes the gate's own verdict rather than re-deriving it. Re-deriving would
 * be equivalent today, but a diagnostic that disagrees with the thing it is
 * diagnosing is worse than no diagnostic, so it reports what actually decided.
 */
export function identity(origin, served) {
  return {
    worker: WORKER_NAME,
    upstream: UPSTREAM_LABEL,
    pathShape: PATH_SHAPE,
    origin: origin || null,
    originAllowed: served,
  };
}

/**
 * Whether this caller gets data at all.
 *
 * The origin gate exists to stop the proxy being a CORS bypass — a browser
 * page reading adsb.fi data the browser would otherwise deny it. A request
 * carrying NO Origin is not that: browsers always attach Origin to a
 * cross-origin fetch, so anything lacking one is a native client, which could
 * call adsb.fi directly and gains nothing here. Refusing those bought no
 * security while making the packaged TV app impossible, because a Tizen
 * widget sends no Origin. A request that DOES carry an Origin still has to be
 * on the list — that is the case the gate is actually for.
 */
export function isServed(hasOrigin, allow) {
  return !hasOrigin || allow !== null;
}

/** Every response body is JSON carrying `worker`, so even a rejection says who
 *  rejected it. Header-only clients can read X-Worker instead. */
function json(body, status, headers) {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Worker': WORKER_NAME, ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHeader = request.headers.get('Origin');
    const origin = originHeader || '';
    const allow = allowedOrigin(origin, env);
    const served = isServed(originHeader !== null, allow);
    // CORS headers only mean anything to a caller that sent an Origin; a
    // native client needs the data, not the permission slip.
    const cors = allow ? corsHeaders(allow) : { 'X-Worker': WORKER_NAME, 'X-Upstream-Source': UPSTREAM_LABEL };

    if (url.pathname === '/' || url.pathname === '/health') {
      return json(identity(origin, served), 200, cors);
    }

    if (!served) {
      return json({ worker: WORKER_NAME, error: 'origin not allowed', origin: origin || null }, 403);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ worker: WORKER_NAME, error: 'method not allowed', method: request.method }, 405, cors);
    }

    const path = upstreamPathFor(url.pathname);
    if (!path) {
      // Echo the path back: a literal "{lat}" or a mangled paste is invisible
      // otherwise, and it is the caller's own input, not ours to withhold.
      return json(
        { worker: WORKER_NAME, error: 'unsupported path', path: url.pathname, pathShape: PATH_SHAPE },
        404,
        cors,
      );
    }

    const target = `${UPSTREAM}${path}`;
    const cache = caches.default;
    const cacheKey = new Request(target, { method: 'GET' });

    let upstream = await cache.match(cacheKey);
    if (!upstream) {
      upstream = await fetch(target, { headers: { Accept: 'application/json' } });
      if (upstream.ok) {
        const cacheable = new Response(upstream.clone().body, upstream);
        cacheable.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
        ctx.waitUntil(cache.put(cacheKey, cacheable));
      }
    }

    const out = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
