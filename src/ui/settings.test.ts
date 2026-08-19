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
    down(); down(); down(); down(); down(); // r -> t -> label -> api -> geo button
    expect(document.activeElement).toBe(root.querySelector('.geo-btn'));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(root.querySelector('input[name=api]'));
  });

  it('ArrowRight/ArrowLeft move between buttons but not inside inputs', () => {
    const root = document.getElementById('app')!;
    renderSettings(root, {}, 'https://x/fw/');
    const send = (key: string): void => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    root.querySelector<HTMLButtonElement>('.copy-btn')!.focus();
    send('ArrowRight');
    expect(document.activeElement).toBe(root.querySelector('.start-btn'));
    send('ArrowRight');
    expect(document.activeElement).toBe(root.querySelector('.reset-btn'));
    send('ArrowLeft');
    expect(document.activeElement).toBe(root.querySelector('.start-btn'));
    // inputs keep left/right for caret movement
    const lat = root.querySelector<HTMLInputElement>('input[name=lat]')!;
    lat.focus();
    send('ArrowRight');
    expect(document.activeElement).toBe(lat);
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

describe('trail minutes field', () => {
  it('renders the configured value', () => {
    const root = document.createElement('div');
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50, trailMinutes: 90 }, 'https://x/');
    expect(root.querySelector<HTMLInputElement>('input[name=t]')!.value).toBe('90');
  });

  it('is blank when unset, and the share link still works', () => {
    const root = document.createElement('div');
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50 }, 'https://x/');
    expect(root.querySelector<HTMLInputElement>('input[name=t]')!.value).toBe('');
    const url = root.querySelector<HTMLElement>('.share-url')!.textContent!;
    expect(url).toContain('lat=64');
    expect(new URLSearchParams(url.split('#')[1]).has('t')).toBe(false);
  });

  it('puts an entered value into the share link', () => {
    const root = document.createElement('div');
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50 }, 'https://x/');
    const t = root.querySelector<HTMLInputElement>('input[name=t]')!;
    t.value = '15';
    root.dispatchEvent(new Event('input', { bubbles: true }));
    const url = root.querySelector<HTMLElement>('.share-url')!.textContent!;
    expect(new URLSearchParams(url.split('#')[1]).get('t')).toBe('15');
  });

  it('marks an out-of-range window invalid', () => {
    const root = document.createElement('div');
    renderSettings(root, { lat: 64, lon: -21, radiusKm: 50 }, 'https://x/');
    const t = root.querySelector<HTMLInputElement>('input[name=t]')!;
    t.value = '999';
    root.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector<HTMLElement>('.share-url')!.textContent).toContain('INVALID');
  });
});

describe('apiBase passthrough', () => {
  // There is no input for it, so without an explicit carry-over the settings
  // form would silently drop a pinned source from the share link.
  it('keeps a pinned source in the generated link', () => {
    const root = document.createElement('div');
    renderSettings(
      root,
      { lat: 64, lon: -21, radiusKm: 50, apiBase: 'https://api.adsb.fi/v2' },
      'https://x/',
    );
    const url = root.querySelector<HTMLElement>('.share-url')!.textContent!;
    expect(new URLSearchParams(url.split('#')[1]).get('api')).toBe('https://api.adsb.fi/v2');
  });
});

describe('renderSettings API field', () => {
  const render = (initial = {}) => {
    const root = document.getElementById('app')!;
    renderSettings(root, initial, 'https://x/fw/');
    return root;
  };
  const api = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[name=api]')!;

  it('shows an existing apiBase so it can be edited, not just preserved', () => {
    const root = render({ lat: 64, lon: -21, radiusKm: 100, apiBase: 'https://proxy.example/v2' });
    expect(api(root).value).toBe('https://proxy.example/v2');
  });

  it('carries a typed URL into the shared link', () => {
    const root = render({ lat: 64, lon: -21, radiusKm: 100 });
    api(root).value = 'https://proxy.example/v2';
    api(root).dispatchEvent(new Event('input', { bubbles: true }));
    const shown = root.querySelector('.share-url')!.textContent!;
    expect(new URLSearchParams(shown.split('#')[1]).get('api')).toBe('https://proxy.example/v2');
  });

  // Blank has to mean "use the built-in feeds", not "api=" — an empty value in
  // the hash would pin the wall to a base URL of nothing.
  it('omits api entirely when the field is left blank', () => {
    const root = render({ lat: 64, lon: -21, radiusKm: 100 });
    const shown = root.querySelector('.share-url')!.textContent!;
    expect(new URLSearchParams(shown.split('#')[1]).has('api')).toBe(false);
  });

  it('clears a previously set apiBase when the field is emptied', () => {
    const root = render({ lat: 64, lon: -21, radiusKm: 100, apiBase: 'https://proxy.example/v2' });
    api(root).value = '   ';
    api(root).dispatchEvent(new Event('input', { bubbles: true }));
    const shown = root.querySelector('.share-url')!.textContent!;
    expect(new URLSearchParams(shown.split('#')[1]).has('api')).toBe(false);
  });
});
