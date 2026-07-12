// Assembles dist/ + tizen/ into build/tizen-app and runs `tizen package`.
// Requires: npm run build first; Tizen Studio CLI on PATH; an active certificate profile.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const STAGE = 'build/tizen-app';

if (!existsSync('dist/index.html')) {
  console.error('dist/ missing — run `npm run build` first.');
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync('dist', STAGE, { recursive: true });
cpSync('tizen/config.xml', `${STAGE}/config.xml`);
cpSync('tizen/icon.png', `${STAGE}/icon.png`);

const profile = process.env.TIZEN_PROFILE || 'flightwall';
try {
  execSync('tizen version', { stdio: 'pipe' });
} catch {
  console.error(
    'Tizen CLI not found on PATH.\n' +
    'Install Tizen Studio (with CLI) from https://developer.tizen.org/development/tizen-studio/download\n' +
    'then add <tizen-studio>/tools/ide/bin to PATH. See docs/tv-setup.md.',
  );
  process.exit(1);
}

console.log(`Packaging with certificate profile "${profile}"…`);
execSync(`tizen package -t wgt -s ${profile} -o . -- ${STAGE}`, { stdio: 'inherit' });
console.log('Done. Install with: tizen install -n FlightWall.wgt -t <TV_DEVICE_NAME>');
