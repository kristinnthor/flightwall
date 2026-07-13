export const STAGE_W = 1920;
export const STAGE_H = 1080;

export interface StageTransform {
  transform: string;
  rotated: boolean;
  scale: number;
}

/**
 * Fit the fixed 1920×1080 stage into the viewport. Portrait viewports get the
 * board rotated 90° (the wall is landscape-only; iOS ignores the manifest
 * orientation, so a portrait-held phone sees the board sideways and rotates).
 */
export function computeStageTransform(viewportW: number, viewportH: number): StageTransform {
  const rotated = viewportH > viewportW;
  const scale = rotated
    ? Math.min(viewportH / STAGE_W, viewportW / STAGE_H)
    : Math.min(viewportW / STAGE_W, viewportH / STAGE_H);
  const rotate = rotated ? ' rotate(90deg)' : '';
  return {
    transform: `translate(-50%, -50%)${rotate} scale(${scale})`,
    rotated,
    scale,
  };
}
