interface ArmOptions {
  armedLabel: string;
  onConfirm: () => void;
  timeoutMs?: number;
}

/**
 * Two-step confirm for destructive buttons without dialogs: first click arms
 * (label swap + .armed class), second click within the timeout confirms,
 * otherwise the button disarms itself back to its original label.
 */
export function armButton(btn: HTMLButtonElement, opts: ArmOptions): void {
  const idleLabel = btn.textContent ?? '';
  const timeoutMs = opts.timeoutMs ?? 5000;
  let disarmTimer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    if (disarmTimer !== null) clearTimeout(disarmTimer);
    disarmTimer = null;
    btn.classList.remove('armed');
    btn.textContent = idleLabel;
  };

  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) {
      disarm();
      opts.onConfirm();
      return;
    }
    btn.classList.add('armed');
    btn.textContent = opts.armedLabel;
    disarmTimer = setTimeout(disarm, timeoutMs);
  });
}
