import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { PlanespottersPhotos } from './photos';

const OK_BODY = {
  photos: [{
    thumbnail_large: { src: 'https://t.plnspttrs.net/x_280.jpg' },
    link: 'https://www.planespotters.net/photo/123',
    photographer: 'Jane Doe',
  }],
};

describe('PlanespottersPhotos', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('maps a photo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(OK_BODY), { status: 200 })));
    const p = await new PlanespottersPhotos(localStorage, 'https://x/pub').getPhoto('4cc2b5');
    expect(p).toEqual({
      thumbnailUrl: 'https://t.plnspttrs.net/x_280.jpg',
      pageLink: 'https://www.planespotters.net/photo/123',
      photographer: 'Jane Doe',
    });
  });

  it('empty photos → null, cached', async () => {
    const f = vi.fn(async () => new Response('{"photos":[]}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const c = new PlanespottersPhotos(localStorage, 'https://x/pub');
    expect(await c.getPhoto('4cc2b5')).toBeNull();
    expect(await c.getPhoto('4cc2b5')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('non-ICAO ~hex skips fetch entirely', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await new PlanespottersPhotos(localStorage, 'https://x/pub').getPhoto('~2f00a1')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
