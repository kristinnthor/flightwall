import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests with DOM available', () => {
    const el = document.createElement('div');
    el.textContent = 'ok';
    expect(el.textContent).toBe('ok');
  });
});
