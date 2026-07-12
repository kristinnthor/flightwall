import type { Photo } from '../types';
import { TtlCache } from './cache';

interface PlanespottersBody {
  photos?: Array<{
    thumbnail_large?: { src?: string };
    link?: string;
    photographer?: string;
  }>;
}

const TTL_MS = 24 * 60 * 60 * 1000;

export class PlanespottersPhotos {
  private cache: TtlCache<Photo>;

  constructor(
    storage: Storage | null,
    private baseUrl = 'https://api.planespotters.net/pub',
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache<Photo>('flightwall.photos.v1', storage, TTL_MS, 200, now);
  }

  async getPhoto(hex: string): Promise<Photo | null> {
    if (hex.startsWith('~')) return null; // non-ICAO address, no DB entry
    const cached = this.cache.get(hex);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`${this.baseUrl}/photos/hex/${encodeURIComponent(hex)}`);
      if (!res.ok) return null; // includes 403 off-origin — transient, not cached
      const body: PlanespottersBody = await res.json();
      const p = (body.photos ?? [])[0];
      if (!p || !p.thumbnail_large?.src || !p.link || !p.photographer) {
        this.cache.set(hex, null);
        return null;
      }
      const photo: Photo = {
        thumbnailUrl: p.thumbnail_large.src,
        pageLink: p.link,
        photographer: p.photographer,
      };
      this.cache.set(hex, photo);
      return photo;
    } catch {
      return null;
    }
  }
}
