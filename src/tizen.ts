/** Best-effort TV integration. No-ops everywhere except a packaged Tizen app. */
export function tvInit(): void {
  try {
    const w = window as unknown as {
      webapis?: { appcommon?: {
        setScreenSaver: (state: number) => void;
        AppCommonScreenSaverState: { SCREEN_SAVER_OFF: number };
      } };
    };
    const ac = w.webapis?.appcommon;
    if (ac) ac.setScreenSaver(ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
  } catch {
    // not on a TV — fine
  }
}
