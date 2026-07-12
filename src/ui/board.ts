import type { Aircraft, Config, Photo, Route } from '../types';
import { computeStatus, type Snapshot } from '../state';
import { climbArrow, compass16, formatAgeSeconds, formatAlt, formatDistanceKm } from '../format';

const MAX_ROWS = 12;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Board {
  private boardEl: HTMLElement;
  private rowsEl: HTMLElement;
  private clockEl: HTMLElement;
  private ageEl: HTMLElement;
  private spotlightEl: HTMLElement;
  private rowNodes = new Map<string, HTMLElement>();
  private exitingNodes = new Map<string, { node: HTMLElement; timer: ReturnType<typeof setTimeout> }>();

  constructor(root: HTMLElement, config: Config) {
    root.innerHTML = '';
    this.boardEl = el('div', 'board');
    this.boardEl.setAttribute('data-status', 'live');

    const header = el('header', 'header');
    const title = el('div', 'title', `OVERHEAD · ${(config.label ?? 'HOME').toUpperCase()}`);
    const radius = el('div', 'radius', `WITHIN ${Math.round(config.radiusKm)} KM`);
    this.clockEl = el('div', 'clock', '--:--:--');
    const statusWrap = el('div', 'status-wrap');
    statusWrap.appendChild(this.clockEl);
    statusWrap.appendChild(el('span', 'status-dot'));
    header.appendChild(title);
    header.appendChild(radius);
    header.appendChild(statusWrap);
    this.boardEl.appendChild(header);

    const cols = el('div', 'row row-head');
    for (const c of ['FLIGHT', 'AIRLINE', 'ROUTE', 'TYPE', 'REG', 'ALT FT', 'SPD KT', 'DIST KM', 'BRG']) {
      cols.appendChild(el('span', 'cell', c));
    }
    this.boardEl.appendChild(cols);

    this.rowsEl = el('div', 'rows');
    this.boardEl.appendChild(this.rowsEl);

    this.spotlightEl = el('div', 'spotlight');
    this.spotlightEl.hidden = true;
    this.boardEl.appendChild(this.spotlightEl);

    const footer = el('footer', 'attribution');
    footer.appendChild(el('span', undefined,
      'DATA: AIRPLANES.LIVE · ROUTES: ADSBDB · PHOTOS: PLANESPOTTERS.NET'));
    this.ageEl = el('span', 'age', '');
    footer.appendChild(this.ageEl);
    this.boardEl.appendChild(footer);

    root.appendChild(this.boardEl);
  }

  update(snap: Snapshot, routes: Map<string, Route | null>): void {
    const visible = snap.aircraft.slice(0, MAX_ROWS);
    const visibleHexes = new Set(visible.map((a) => a.hex));

    for (const [hex, node] of this.rowNodes) {
      if (!visibleHexes.has(hex)) {
        this.rowNodes.delete(hex);
        node.classList.add('row-exit');
        const timer = setTimeout(() => {
          node.remove();
          this.exitingNodes.delete(hex);
        }, 600);
        this.exitingNodes.set(hex, { node, timer });
      }
    }

    this.rowsEl.querySelectorAll('.clear-skies, .more-line').forEach((n) => n.remove());

    visible.forEach((a, i) => {
      let node = this.rowNodes.get(a.hex);
      if (!node) {
        const exiting = this.exitingNodes.get(a.hex);
        if (exiting) {
          clearTimeout(exiting.timer);
          exiting.node.remove();
          this.exitingNodes.delete(a.hex);
        }
        node = el('div', 'row row-enter');
        node.setAttribute('data-hex', a.hex);
        this.rowNodes.set(a.hex, node);
      }
      this.fillRow(node, a, routes);
      const current = this.rowsEl.children[i];
      if (current !== node) this.rowsEl.insertBefore(node, current ?? null);
    });

    if (visible.length === 0) {
      this.rowsEl.appendChild(el('div', 'clear-skies', 'CLEAR SKIES'));
    }
    const overflow = snap.aircraft.length - visible.length;
    if (overflow > 0) {
      this.rowsEl.appendChild(el('div', 'more-line', `+${overflow} MORE`));
    }
  }

  private fillRow(node: HTMLElement, a: Aircraft, routes: Map<string, Route | null>): void {
    const route = a.callsign ? routes.get(a.callsign) ?? null : null;
    const routeText = route?.originCode && route?.destCode
      ? `${route.originCode}→${route.destCode}` : '—';
    const cells = [
      a.callsign ?? a.registration ?? a.hex.toUpperCase(),
      (route?.airlineName ?? '—').toUpperCase(),
      routeText,
      a.typeCode ?? '—',
      a.registration ?? '—',
      `${formatAlt(a.altitudeFt)}${climbArrow(a.verticalRateFpm)}`,
      a.groundSpeedKt === null ? '—' : String(Math.round(a.groundSpeedKt)),
      formatDistanceKm(a.distanceKm),
      compass16(a.bearingDeg),
    ];
    node.innerHTML = '';
    for (const c of cells) node.appendChild(el('span', 'cell', c));
  }

  setSpotlight(a: Aircraft | null, route: Route | null, photo: Photo | null): void {
    this.spotlightEl.innerHTML = '';
    if (!a || !photo) {
      this.spotlightEl.hidden = true;
      return;
    }
    this.spotlightEl.hidden = false;
    const link = el('a');
    link.href = photo.pageLink;
    link.target = '_blank';
    link.rel = 'noopener';
    const img = el('img');
    img.src = photo.thumbnailUrl;
    img.alt = a.callsign ?? a.hex;
    link.appendChild(img);
    this.spotlightEl.appendChild(link);

    const info = el('div', 'spotlight-info');
    const parts: string[] = [];
    if (route?.airlineName) parts.push(route.airlineName);
    if (route?.originCity && route?.destCity) parts.push(`${route.originCity} → ${route.destCity}`);
    if (a.typeCode) parts.push(a.typeCode);
    info.appendChild(el('div', 'spotlight-line', parts.join(' · ') || (a.callsign ?? a.hex)));
    info.appendChild(el('div', 'spotlight-credit', `© ${photo.photographer} / planespotters.net`));
    this.spotlightEl.appendChild(info);
  }

  tickClock(now: number, lastSuccessAt: number): void {
    const d = new Date(now);
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.clockEl.textContent =
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
    const status = computeStatus(lastSuccessAt, now);
    this.boardEl.setAttribute('data-status', status);
    this.ageEl.textContent = status === 'live' ? '' : `STALE ${formatAgeSeconds(now - lastSuccessAt)}`;
  }
}
