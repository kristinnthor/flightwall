import { clearStoredConfig } from './config';

/** Wipe stored config + caches, strip the config hash, and restart at first-run setup. */
export function performReset(): void {
  clearStoredConfig(localStorage);
  // replaceState (not location.hash = '') so exactly one reload happens.
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}
