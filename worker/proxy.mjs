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
// Then point the wall at it:
//   #...&api=https://<worker-host>/v2/lat/{lat}/lon/{lon}/dist/{nm}

const UPSTREAM = 'https://opendata.adsb.fi/api';
/** Network actually supplying the data. Sent back so the wall credits adsb.fi
 *  rather than this proxy's hostname — attribution is a terms requirement. */
const UPSTREAM_LABEL = 'ADSB.FI';

/** Short enough to stay fresh at a 5 s poll, long enough that several viewers
 *  behind one proxy cannot breach adsb.fi's 1 request/second limit. */
const CACHE_SECONDS = 4;

/**
 * Parse an incoming path into the upstream query, or null if it is not the
 * shape we forward. This is the security boundary: anything unrecognised is
 * rejected rather than passed through.
 */
export function upstreamPathFor(pathname) {
  const m = /^\/(v2|v3)\/lat\/(-?\d{1,3}(?:\.\d+)?)\/lon\/(-?\d{1,3}(?:\.\d+)?)\/dist\/(\d{1,3})\/?$/
    .exec(pathname);
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
    'Access-Control-Expose-Headers': 'X-Upstream-Source',
    'X-Upstream-Source': UPSTREAM_LABEL,
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allow = allowedOrigin(origin, env);
    if (!allow) return new Response('origin not allowed\n', { status: 403 });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allow) });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed\n', { status: 405, headers: corsHeaders(allow) });
    }

    const path = upstreamPathFor(new URL(request.url).pathname);
    if (!path) return new Response('unsupported path\n', { status: 404, headers: corsHeaders(allow) });

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
    for (const [k, v] of Object.entries(corsHeaders(allow))) out.headers.set(k, v);
    return out;
  },
};
