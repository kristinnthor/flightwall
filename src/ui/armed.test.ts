import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { armButton } from './armed';

describe('armButton', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const btn = document.createElement('button');
    btn.textContent = '↺';
    const onConfirm = vi.fn();
    armButton(btn, { armedLabel: 'RESET?', onConfirm, timeoutMs: 5000 });
    return { btn, onConfirm };
  }

  it('first click arms without confirming', () => {
    const { btn, onConfirm } = setup();
    btn.click();
    expect(btn.textContent).toBe('RESET?');
    expect(btn.classList.contains('armed')).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('second click while armed confirms', () => {
    const { btn, onConfirm } = setup();
    btn.click();
    btn.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disarms after the timeout and restores the label', () => {
    const { btn, onConfirm } = setup();
    btn.click();
    vi.advanceTimersByTime(5000);
    expect(btn.textContent).toBe('↺');
    expect(btn.classList.contains('armed')).toBe(false);
    btn.click(); // this click arms again, must NOT confirm
    expect(onConfirm).not.toHaveBeenCalled();
    expect(btn.textContent).toBe('RESET?');
  });

  it('confirming clears the pending disarm timer', () => {
    const { btn, onConfirm } = setup();
    btn.click();
    btn.click();
    vi.advanceTimersByTime(10_000);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
