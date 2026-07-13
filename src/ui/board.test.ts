import { describe, it, expect, beforeEach } from 'vitest';
import { Board, type RowExtras } from './board';
import type { Aircraft, Route } from '../types';
import type { Snapshot } from '../state';

const CFG = { lat: 64, lon: -21, radiusKm: 50, label: 'HOME' };

function ac(hex: string, distanceKm: number, over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex, callsign: `CS${hex.toUpperCase()}`, registration: 'TF-XXX', typeCode: 'B39M',
    altitudeFt: 34000, groundSpeedKt: 450, verticalRateFpm: 1200,
    distanceKm, bearingDeg: 315, lat: 64, lon: -21, ...over,
  };
}

function snap(aircraft: Aircraft[]): Snapshot {
  return { aircraft, entered: new Set(), left: new Set(), lastSuccessAt: Date.now() };
}

const ICE_ROUTE: Route = {
  airlineName: 'Icelandair',
  originCode: 'KEF', originCity: 'Reykjavík', originLat: 63.985, originLon: -22.6056,
  destCode: 'JFK', destCity: 'New York', destLat: 40.6398, destLon: -73.7789,
};

const NONE = new Map<string, RowExtras>();

describe('Board', () => {
  let root: HTMLElement;
  let board: Board;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    board = new Board(root, CFG);
  });

  it('renders header label, radius, and attribution footer', () => {
    expect(root.textContent).toContain('HOME');
    expect(root.textContent).toContain('WITHIN 50 KM');
    expect(root.querySelector('.attribution')?.textContent).toContain('AIRPLANES.LIVE');
  });

  it('renders one row per aircraft in given order with data cells', () => {
    board.update(snap([ac('aaa', 3.2), ac('bbb', 12)]), NONE);
    const rows = [...root.querySelectorAll('[data-hex]')];
    expect(rows.map((r) => r.getAttribute('data-hex'))).toEqual(['aaa', 'bbb']);
    const first = rows[0]!;
    expect(first.textContent).toContain('CSAAA');
    expect(first.textContent).toContain('34,000');
    expect(first.textContent).toContain('↑');
    expect(first.textContent).toContain('3.2');
    expect(first.textContent).toContain('NW');
  });

  it('shows route when known, em-dash when not', () => {
    const extras = new Map<string, RowExtras>([
      ['aaa', { route: ICE_ROUTE, operator: null }],
    ]);
    board.update(snap([ac('aaa', 3), ac('bbb', 5)]), extras);
    const rows = [...root.querySelectorAll('[data-hex]')];
    expect(rows[0]?.textContent).toContain('KEF→JFK');
    expect(rows[0]?.textContent).toContain('ICELANDAIR');
    expect(rows[1]?.textContent).toContain('—');
  });

  it('falls back to the registered operator for AIRLINE when the route has none', () => {
    const extras = new Map<string, RowExtras>([
      ['aaa', { route: null, operator: 'Vulkan Air' }],
    ]);
    board.update(snap([ac('aaa', 3)]), extras);
    const row = root.querySelector('[data-hex="aaa"]');
    expect(row?.textContent).toContain('VULKAN AIR');
  });

  it('caps at 12 rows and shows +N MORE', () => {
    const many = Array.from({ length: 15 }, (_, i) => ac(`h${i}`, i + 1));
    board.update(snap(many), NONE);
    expect(root.querySelectorAll('[data-hex]')).toHaveLength(12);
    expect(root.querySelector('.more-line')?.textContent).toContain('+3 MORE');
  });

  it('shows CLEAR SKIES when empty', () => {
    board.update(snap([]), NONE);
    expect(root.querySelector('.clear-skies')?.textContent).toContain('CLEAR SKIES');
  });

  it('does not leave a duplicate node when a hex exits and re-enters before its exit timeout fires', () => {
    board.update(snap([ac('aaa', 3)]), NONE);
    board.update(snap([]), NONE);
    board.update(snap([ac('aaa', 3)]), NONE);
    expect(root.querySelectorAll('[data-hex="aaa"]')).toHaveLength(1);
  });

  it('tickClock sets status attribute', () => {
    const t = Date.now();
    board.tickClock(t + 20_000, t);
    expect(root.querySelector('.board')?.getAttribute('data-status')).toBe('stale');
    board.tickClock(t + 61_000, t);
    expect(root.querySelector('.board')?.getAttribute('data-status')).toBe('lost');
  });

  it('spotlight renders credited, linked photo', () => {
    board.setSpotlight(
      ac('aaa', 2),
      ICE_ROUTE,
      { thumbnailUrl: 'https://t/x.jpg', pageLink: 'https://p/1', photographer: 'Jane Doe' },
    );
    const link = root.querySelector<HTMLAnchorElement>('.spotlight a');
    expect(link?.href).toBe('https://p/1');
    expect(link?.rel).not.toContain('nofollow');
    expect(link?.rel).toContain('noopener');
    expect(root.querySelector('.spotlight img')?.getAttribute('src')).toBe('https://t/x.jpg');
    expect(root.querySelector('.spotlight')?.textContent).toContain('© Jane Doe');
  });

  it('spotlight uses the operator when the route has no airline', () => {
    board.setSpotlight(
      ac('aaa', 2), null,
      { thumbnailUrl: 'https://t/x.jpg', pageLink: 'https://p/1', photographer: 'Jane Doe' },
      'Comlux Malta Ltd',
    );
    expect(root.querySelector('.spotlight-line')?.textContent).toContain('Comlux Malta Ltd');
  });

  it('spotlight hides without photo', () => {
    board.setSpotlight(ac('aaa', 2), null, null);
    expect(root.querySelector<HTMLElement>('.spotlight')?.hidden).toBe(true);
  });
});
