import type { Config } from '../types';
import { isValidConfig, serializeToHash } from '../config';
import { performReset } from '../reset';

export function buildShareUrl(pageUrl: string, cfg: Config): string {
  return pageUrl.replace(/#.*$/, '') + serializeToHash(cfg);
}

export function renderSettings(root: HTMLElement, initial: Partial<Config>, pageUrl: string): void {
  root.innerHTML = `
    <div class="settings">
      <h1>FLIGHTWALL SETUP</h1>
      <label>LATITUDE <input name="lat" type="number" step="any"></label>
      <label>LONGITUDE <input name="lon" type="number" step="any"></label>
      <label>RADIUS KM (1–460) <input name="r" type="number" min="1" max="460"></label>
      <label>LABEL <input name="label" type="text" maxlength="24"></label>
      <button type="button" class="geo-btn">USE MY LOCATION</button>
      <div class="share-url"></div>
      <div class="settings-actions">
        <button type="button" class="copy-btn">COPY LINK</button>
        <button type="button" class="start-btn">START</button>
        <button type="button" class="reset-btn">RESET</button>
      </div>
      <p class="settings-hint">Open the copied link on the TV — the wall configures itself from the URL.
        On a TV remote: arrows move, OK selects, BACK returns to the board.</p>
    </div>`;

  const input = (name: string): HTMLInputElement =>
    root.querySelector<HTMLInputElement>(`input[name=${name}]`)!;

  input('lat').value = initial.lat !== undefined ? String(initial.lat) : '';
  input('lon').value = initial.lon !== undefined ? String(initial.lon) : '';
  input('r').value = initial.radiusKm !== undefined ? String(initial.radiusKm) : '';
  input('label').value = initial.label ?? '';
  const shareEl = root.querySelector<HTMLElement>('.share-url')!;

  const currentConfig = (): Config | null => {
    const cfg: Record<string, unknown> = {
      lat: Number(input('lat').value),
      lon: Number(input('lon').value),
      radiusKm: Number(input('r').value),
    };
    if (input('label').value) cfg.label = input('label').value;
    return isValidConfig(cfg) ? cfg : null;
  };

  const refresh = (): void => {
    const cfg = currentConfig();
    shareEl.textContent = cfg ? buildShareUrl(pageUrl, cfg) : 'INVALID — check the fields above';
  };

  root.addEventListener('input', refresh);
  refresh();
  input('lat').focus(); // TV remotes navigate by focus — land on the form


  root.querySelector('.geo-btn')?.addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      input('lat').value = pos.coords.latitude.toFixed(4);
      input('lon').value = pos.coords.longitude.toFixed(4);
      refresh();
    });
  });

  root.querySelector('.copy-btn')?.addEventListener('click', () => {
    const cfg = currentConfig();
    if (cfg && navigator.clipboard) void navigator.clipboard.writeText(buildShareUrl(pageUrl, cfg));
  });

  root.querySelector('.start-btn')?.addEventListener('click', () => {
    const cfg = currentConfig();
    if (cfg) {
      location.hash = serializeToHash(cfg);
      location.reload();
    }
  });

  root.querySelector('.reset-btn')?.addEventListener('click', performReset);
}
