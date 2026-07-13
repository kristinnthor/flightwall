import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildShareUrl, renderSettings } from './settings';

describe('buildShareUrl', () => {
  it('joins page URL and hash', () => {
    expect(buildShareUrl('https://x.github.io/flightwall/', { lat: 64.14, lon: -21.94, radiusKm: 50, label: 'HOME' }))
      .toBe('https://x.github.io/flightwall/#lat=64.14&lon=-21.94&r=50&label=HOME');
  });
});

describe('renderSettings', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

  it('renders inputs with initial values and live URL', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50 }, 'https://x/fw/');
    expect(root.querySelector<HTMLInputElement>('input[name=lat]')?.value).toBe('64');
    expect(root.querySelector<HTMLInputElement>('input[name=r]')?.value).toBe('50');
    expect(root.querySelector('.share-url')?.textContent).toContain('#lat=64&lon=-21&r=50');
  });

  it('updates URL as inputs change and flags invalid input', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    const lat = root.querySelector<HTMLInputElement>('input[name=lat]')!;
    const lon = root.querySelector<HTMLInputElement>('input[name=lon]')!;
    const r = root.querySelector<HTMLInputElement>('input[name=r]')!;
    lat.value = '64.1'; lat.dispatchEvent(new Event('input', { bubbles: true }));
    lon.value = '-21.9'; lon.dispatchEvent(new Event('input', { bubbles: true }));
    r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.share-url')?.textContent).toContain('lat=64.1');
    r.value = '9999'; r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.share-url')?.textContent).toContain('INVALID');
  });

  it('does not interpret label as HTML', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, { label: '"><img src=x onerror=alert(1)>' }, 'https://x/fw/');
    expect(root.querySelectorAll('img')).toHaveLength(0);
    expect(root.querySelector<HTMLInputElement>('input[name=label]')?.value).toBe('"><img src=x onerror=alert(1)>');
  });

  it('focuses the first input on render (TV remote lands on the form)', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    expect(document.activeElement).toBe(root.querySelector('input[name=lat]'));
  });

  it('uses text inputs (no number spinner trapping TV arrow keys)', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    for (const name of ['lat', 'lon', 'r']) {
      const el = root.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
      expect(el.type).toBe('text');
      expect(el.getAttribute('inputmode')).toBe('decimal');
    }
  });

  it('accepts comma decimals (Icelandic keyboards)', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    const set = (name: string, v: string): void => {
      const el = root.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('lat', '64,13');
    set('lon', '-21,94');
    set('r', '50');
    expect(root.querySelector('.share-url')?.textContent).toContain('lat=64.13&lon=-21.94&r=50');
  });

  it('ArrowDown/ArrowUp move focus through fields and buttons', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    const lat = root.querySelector<HTMLInputElement>('input[name=lat]')!;
    const lon = root.querySelector<HTMLInputElement>('input[name=lon]')!;
    const down = (): void => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    };
    expect(document.activeElement).toBe(lat);
    down();
    expect(document.activeElement).toBe(lon);
    down(); down(); down(); // r -> label -> geo button
    expect(document.activeElement).toBe(root.querySelector('.geo-btn'));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(root.querySelector('input[name=label]'));
  });

  it('RESET clears stored config and caches, strips the hash, and reloads', () => {
    localStorage.clear();
    localStorage.setItem('flightwall.config', '{"lat":1}');
    localStorage.setItem('flightwall.routes.v1', '{}');
    localStorage.setItem('flightwall.photos.v1', '{}');
    location.hash = '#lat=64&lon=-21&r=50';
    const reloadSpy = vi.spyOn(location, 'reload').mockImplementation(() => {});
    const root = document.getElementById('app')!;
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50 }, 'https://x/fw/');
    const btn = root.querySelector<HTMLButtonElement>('.reset-btn');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(localStorage.getItem('flightwall.config')).toBeNull();
    expect(localStorage.getItem('flightwall.routes.v1')).toBeNull();
    expect(localStorage.getItem('flightwall.photos.v1')).toBeNull();
    expect(location.href).not.toContain('#');
    expect(reloadSpy).toHaveBeenCalled();
    reloadSpy.mockRestore();
  });
});
