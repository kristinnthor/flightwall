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
    for (const p of ['/', '/v2/point/64/-21/25', '/admin', '/v2/lat/64/lon/-21/dist/999']) {
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
});
