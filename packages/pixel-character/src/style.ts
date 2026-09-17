import { finiteRange } from "./body.ts";
export interface PixelStyle {
  outline: boolean;
  depthEdgeStrength: number;
  normalEdgeStrength: number;
  shadingSteps: number;
  paletteStrength: number;
}
export const DEFAULT_STYLE: Readonly<PixelStyle> = Object.freeze({
  outline: true,
  depthEdgeStrength: 0.25,
  normalEdgeStrength: 0,
  shadingSteps: 4,
  paletteStrength: 0.45,
});
export function validateStyle(
  patch: Partial<PixelStyle>,
  base = DEFAULT_STYLE,
): PixelStyle {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key))
      throw new TypeError(`알 수 없는 스타일: ${key}`);
    if (key === "outline") {
      if (typeof value !== "boolean")
        throw new TypeError("outline은 boolean이어야 합니다.");
      next.outline = value;
    } else {
      const k = key as Exclude<keyof PixelStyle, "outline">;
      next[k] = finiteRange(
        value,
        k === "shadingSteps" ? 2 : 0,
        k === "shadingSteps" ? 8 : 1,
        key,
      );
      if (k === "shadingSteps" && !Number.isInteger(value))
        throw new TypeError("명암 단계는 정수여야 합니다.");
    }
  }
  return next;
}
