/**
 * Runs under node, not happy-dom: happy-dom's Request enforces the forbidden
 * header rule and strips Origin, which the worker reads to decide access. A
 * real Worker receives Origin off the wire, so stripping it is a test artifact.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from './proxy.mjs';

const ORIGIN = 'https://kristinnthor.github.io';
const ENV = { ALLOWED_ORIGINS: ORIGIN };
const ctx = { waitUntil: () => {} };

// adsb.fi's real shape, as observed from the live endpoint: the aircraft array
// is under "aircraft", not "ac", and it ships now/resultCount/ptime alongside.
const UPSTREAM_BODY = {
  now: 1755600000,
  aircraft: [{ hex: '4cc2b5', flight: 'ICE615  ', lat: 64.3, lon: -21.6, alt_baro: 34000 }],
  resultCount: 1,
  ptime: 12,
};

let fetched;

beforeEach(() => {
  fetched = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = vi.fn(async (url) => {
    fetched.push(String(url));
    return new Response(JSON.stringify(UPSTREAM_BODY), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

const call = (path, init = {}) =>
  worker.fetch(
    new Request(`https://proxy.example${path}`, { headers: { Origin: ORIGIN }, ...init }),
    ENV,
    ctx,
  );

describe('worker fetch handler', () => {
  it('forwards a valid query to adsb.fi and returns the body', async () => {
    const res = await call('/v2/lat/64.146588/lon/-21.9064249/dist/162');
    expect(res.status).toBe(200);
    expect(fetched).toEqual([
      'https://opendata.adsb.fi/api/v2/lat/64.146588/lon/-21.9064249/dist/162',
    ]);
    const body = await res.json();
    expect(body.aircraft).toHaveLength(1);
  });

  // The entire reason this worker exists.
  it('adds the CORS header the upstream omits', async () => {
    const res = await call('/v2/lat/64/lon/-21/dist/25');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('declares the upstream so the wall credits adsb.fi, not the proxy host', async () => {
    const res = await call('/v2/lat/64/lon/-21/dist/25');
    expect(res.headers.get('X-Upstream-Source')).toBe('ADSB.FI');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Upstream-Source');
  });

  it('answers a preflight without calling upstream', async () => {
    const res = await call('/v2/lat/64/lon/-21/dist/25', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(fetched).toEqual([]);
  });

  // Without these it would be an open proxy anyone could point anywhere.
  it('refuses an origin that is not allowed, before doing any work', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.example/v2/lat/64/lon/-21/dist/25', {
        headers: { Origin: 'https://evil.example' },
      }),
      ENV,
      ctx,
    );
    expect(res.status).toBe(403);
    expect(fetched).toEqual([]);
  });

  it('refuses a path outside the point-query shape', async () => {
    for (const p of ['/v2/point/64/-21/25', '/admin', '/v2/lat/64/lon/-21/dist/999']) {
      const res = await call(p);
      expect(res.status).toBe(404);
    }
    expect(fetched).toEqual([]);
  });

  it('refuses non-GET methods', async () => {
    const res = await call('/v2/lat/64/lon/-21/dist/25', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(fetched).toEqual([]);
  });

  it('serves from cache without hitting upstream again', async () => {
    globalThis.caches = {
      default: {
        match: async () => new Response(JSON.stringify(UPSTREAM_BODY), { status: 200 }),
        put: async () => {},
      },
    };
    const res = await call('/v2/lat/64/lon/-21/dist/25');
    expect(res.status).toBe(200);
    expect(fetched).toEqual([]); // adsb.fi allows only 1 request/second
  });

  it('passes an upstream failure through rather than inventing data', async () => {
    globalThis.fetch = async () => new Response('upstream down', { status: 502 });
    const res = await call('/v2/lat/64/lon/-21/dist/25');
    expect(res.status).toBe(502);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  // Every rejection has to name the worker, because the alternative — an
  // anonymous 404 — is exactly what Cloudflare returns for a hostname with no
  // worker on it, and the two are then impossible to tell apart.
  it('identifies itself on every rejection it issues', async () => {
    const rejections = [
      await call('/admin'),
      await call('/v2/lat/64/lon/-21/dist/25', { method: 'POST' }),
      await worker.fetch(
        new Request('https://proxy.example/v2/lat/64/lon/-21/dist/25', {
          headers: { Origin: 'https://evil.example' },
        }),
        ENV,
        ctx,
      ),
    ];
    for (const res of rejections) {
      expect(res.headers.get('X-Worker')).toBe('flightwall-proxy');
      expect((await res.json()).worker).toBe('flightwall-proxy');
    }
  });

  it('names the path it rejected, so a literal {lat} is visible', async () => {
    const res = await call('/v2/lat/{lat}/lon/{lon}/dist/{nm}');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('unsupported path');
    expect(body.path).toBe('/v2/lat/%7Blat%7D/lon/%7Blon%7D/dist/%7Bnm%7D');
  });
});

// A proxy that refuses everything without an allowed Origin cannot answer the
// first question after a deploy — did it land? A browser visit sends no Origin,
// so the 403 was indistinguishable from a missing worker.
describe('identity endpoint', () => {
  const bare = (path) => worker.fetch(new Request(`https://proxy.example${path}`), ENV, ctx);

  it('answers a browser visit that carries no Origin at all', async () => {
    for (const path of ['/', '/health']) {
      const res = await bare(path);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.worker).toBe('flightwall-proxy');
      expect(body.upstream).toBe('ADSB.FI');
      expect(body.origin).toBeNull();
      expect(body.originAllowed).toBe(false);
    }
    expect(fetched).toEqual([]);
  });

  it('reports back whether the calling origin is accepted', async () => {
    const ok = await call('/health');
    expect((await ok.json()).originAllowed).toBe(true);

    const denied = await worker.fetch(
      new Request('https://proxy.example/health', { headers: { Origin: 'https://evil.example' } }),
      ENV,
      ctx,
    );
    expect(denied.status).toBe(200); // the report is the point; it is not a proxy grant
    const body = await denied.json();
    expect(body.originAllowed).toBe(false);
    expect(body.origin).toBe('https://evil.example');
  });

  it('publishes the path shape a caller has to match', async () => {
    expect((await bare('/')).headers.get('X-Worker')).toBe('flightwall-proxy');
    const body = await (await bare('/')).json();
    expect(body.pathShape).toBe('/{v2|v3}/lat/{lat}/lon/{lon}/dist/{nm}');
  });

  it('grants CORS to an allowed origin but not to a stranger', async () => {
    const ok = await call('/health');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const bareRes = await bare('/health');
    expect(bareRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // A diagnostic that disagrees with the gate it reports on is worse than none,
  // so originAllowed has to track whether proxying actually works — including
  // under a wildcard, where a stranger origin is genuinely served.
  it('reports originAllowed in lockstep with whether proxying is permitted', async () => {
    const stranger = 'https://elsewhere.example';
    for (const env of [{ ALLOWED_ORIGINS: ORIGIN }, { ALLOWED_ORIGINS: '*' }]) {
      const req = (path) =>
        worker.fetch(new Request(`https://proxy.example${path}`, { headers: { Origin: stranger } }), env, ctx);

      const reported = (await (await req('/health')).json()).originAllowed;
      const proxied = (await req('/v2/lat/64/lon/-21/dist/25')).status !== 403;
      expect(reported).toBe(proxied);
    }
  });
});
