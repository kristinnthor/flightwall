import { describe, it, expect } from 'vitest';
import { computeStageTransform } from './stage';

describe('computeStageTransform', () => {
  it('landscape viewport scales without rotation', () => {
    const t = computeStageTransform(1920, 1080);
    expect(t.rotated).toBe(false);
    expect(t.scale).toBe(1);
    expect(t.transform).toBe('translate(-50%, -50%) scale(1)');
  });

  it('smaller landscape window scales down', () => {
    const t = computeStageTransform(960, 540);
    expect(t.rotated).toBe(false);
    expect(t.scale).toBeCloseTo(0.5);
  });

  it('portrait viewport rotates 90° and scales to the swapped axes', () => {
    const t = computeStageTransform(390, 844);
    expect(t.rotated).toBe(true);
    // rotated: stage width maps to viewport height, stage height to width
    expect(t.scale).toBeCloseTo(Math.min(844 / 1920, 390 / 1080), 5);
    expect(t.transform).toContain('rotate(90deg)');
    expect(t.transform).toContain('translate(-50%, -50%)');
  });

  it('square viewport does not rotate', () => {
    const t = computeStageTransform(800, 800);
    expect(t.rotated).toBe(false);
    expect(t.scale).toBeCloseTo(800 / 1920, 5);
  });
});
