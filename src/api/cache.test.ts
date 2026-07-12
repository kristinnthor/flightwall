import { describe, it, expect, beforeEach } from 'vitest';
import { TtlCache } from './cache';

describe('TtlCache', () => {
  beforeEach(() => localStorage.clear());

  it('miss is undefined, negative hit is null', () => {
    const c = new TtlCache<string>('k', localStorage, 1000, 10, () => 0);
    expect(c.get('a')).toBeUndefined();
    c.set('a', null);
    expect(c.get('a')).toBeNull();
  });

  it('stores and expires by TTL', () => {
    let t = 0;
    const c = new TtlCache<string>('k', localStorage, 1000, 10, () => t);
    c.set('a', 'v');
    expect(c.get('a')).toBe('v');
    t = 1001;
    expect(c.get('a')).toBeUndefined();
  });

  it('persists to storage and reloads', () => {
    const c1 = new TtlCache<string>('k', localStorage, 1000, 10, () => 0);
    c1.set('a', 'v');
    const c2 = new TtlCache<string>('k', localStorage, 1000, 10, () => 0);
    expect(c2.get('a')).toBe('v');
  });

  it('evicts oldest beyond maxEntries', () => {
    const c = new TtlCache<number>('k', localStorage, 10_000, 2, () => 0);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('survives corrupt storage and null storage', () => {
    localStorage.setItem('k', '{corrupt');
    expect(() => new TtlCache<string>('k', localStorage, 1000, 10)).not.toThrow();
    const c = new TtlCache<string>('k', null, 1000, 10);
    c.set('a', 'v');
    expect(c.get('a')).toBe('v');
  });
});
