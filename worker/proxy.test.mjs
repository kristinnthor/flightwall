import { describe, it, expect } from 'vitest';
import { upstreamPathFor, allowedOrigin } from './proxy.mjs';

// This is the security boundary. The worker exists to add one CORS header to
// one query; if it forwarded arbitrary paths it would be an open proxy that
// anyone could point at any host.
describe('upstreamPathFor', () => {
  it('accepts the v2 and v3 point-query shapes', () => {
    expect(upstreamPathFor('/v2/lat/64.146588/lon/-21.9064249/dist/249'))
      .toBe('/v2/lat/64.146588/lon/-21.9064249/dist/249');
    expect(upstreamPathFor('/v3/lat/64/lon/-21/dist/25'))
      .toBe('/v3/lat/64/lon/-21/dist/25');
  });

  it('tolerates a trailing slash', () => {
    expect(upstreamPathFor('/v2/lat/64/lon/-21/dist/25/')).toBe('/v2/lat/64/lon/-21/dist/25');
  });

  it('refuses anything that is not one of the two supported layouts', () => {
    for (const p of [
      '/', '/v2', '/v1/lat/64/lon/-21/dist/25', '/v2/point/64/-21',
      '/v2/lat/64/lon/-21', '/anything', '/v2/lat/64/lon/-21/dist/25/extra',
      '/v2/point/64/-21/25/extra',
    ]) {
      expect(upstreamPathFor(p)).toBeNull();
    }
  });

  // A base URL with no {lat} placeholders produces this layout, which is what
  // makes the TV configurable without typing curly braces on a remote.
  it('maps the brace-free /point/ layout onto the same upstream path', () => {
    expect(upstreamPathFor('/v2/point/64/-21/25')).toBe('/v2/lat/64/lon/-21/dist/25');
    expect(upstreamPathFor('/v3/point/64.146588/-21.9064249/162/')).toBe(
      '/v3/lat/64.146588/lon/-21.9064249/dist/162',
    );
  });

  // Without this it could be coaxed into requesting other upstream paths.
  it('refuses traversal and injection attempts', () => {
    for (const p of [
      '/v2/lat/64/lon/-21/dist/25/../../admin',
      '/v2/lat/..%2F..%2Fetc/lon/-21/dist/25',
      '/v2/lat/64/lon/-21/dist/25?x=1',
      '/v2/lat/6 4/lon/-21/dist/25',
      '//evil.example.com/v2/lat/64/lon/-21/dist/25',
    ]) {
      expect(upstreamPathFor(p)).toBeNull();
    }
  });

  it('rejects out-of-range coordinates and distances', () => {
    expect(upstreamPathFor('/v2/lat/91/lon/0/dist/25')).toBeNull();
    expect(upstreamPathFor('/v2/lat/0/lon/181/dist/25')).toBeNull();
    expect(upstreamPathFor('/v2/lat/0/lon/0/dist/0')).toBeNull();
    expect(upstreamPathFor('/v2/lat/0/lon/0/dist/251')).toBeNull(); // upstream caps at 250
  });
});

describe('allowedOrigin', () => {
  it('allows the configured origin and echoes it back', () => {
    const env = { ALLOWED_ORIGINS: 'https://a.example' };
    expect(allowedOrigin('https://a.example', env)).toBe('https://a.example');
  });

  it('refuses an origin that is not listed', () => {
    const env = { ALLOWED_ORIGINS: 'https://a.example' };
    expect(allowedOrigin('https://evil.example', env)).toBeNull();
    expect(allowedOrigin('', env)).toBeNull();
  });

  it('supports several origins', () => {
    const env = { ALLOWED_ORIGINS: 'https://a.example, https://b.example' };
    expect(allowedOrigin('https://b.example', env)).toBe('https://b.example');
  });

  // Opt-in only: defaulting to this would make it a free CORS proxy.
  it('honours an explicit wildcard but never defaults to one', () => {
    expect(allowedOrigin('https://anything', { ALLOWED_ORIGINS: '*' })).toBe('*');
    expect(allowedOrigin('https://anything', {})).toBeNull();
    expect(allowedOrigin('https://anything', undefined)).toBeNull();
  });

  it('defaults to the published wall origin', () => {
    expect(allowedOrigin('https://kristinnthor.github.io', {}))
      .toBe('https://kristinnthor.github.io');
  });
});
