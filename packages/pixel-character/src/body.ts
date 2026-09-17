/** Dimensions use H = unscaled crown-to-chin height. Accessories are excluded. */
export const BODY_PARAMETERS = {
  headWidth: {
    label: "머리 너비",
    unit: "H",
    min: 0.78,
    max: 1.18,
    default: 1,
    step: 0.01,
  },
  headDepth: {
    label: "머리 깊이",
    unit: "H",
    min: 0.65,
    max: 1,
    default: 0.82,
    step: 0.01,
  },
  shoulderWidth: {
    label: "어깨 너비",
    unit: "H",
    min: 0.7,
    max: 1.15,
    default: 0.88,
    step: 0.01,
  },
  chestWidth: {
    label: "가슴 너비",
    unit: "H",
    min: 0.52,
    max: 0.88,
    default: 0.68,
    step: 0.01,
  },
  chestDepth: {
    label: "가슴 깊이",
    unit: "H",
    min: 0.32,
    max: 0.58,
    default: 0.43,
    step: 0.01,
  },
  waistWidth: {
    label: "허리 너비",
    unit: "H",
    min: 0.4,
    max: 0.72,
    default: 0.52,
    step: 0.01,
  },
  waistDepth: {
    label: "허리 깊이",
    unit: "H",
    min: 0.28,
    max: 0.5,
    default: 0.35,
    step: 0.01,
  },
  pelvisWidth: {
    label: "골반 너비",
    unit: "H",
    min: 0.5,
    max: 0.82,
    default: 0.62,
    step: 0.01,
  },
  pelvisDepth: {
    label: "골반 깊이",
    unit: "H",
    min: 0.32,
    max: 0.56,
    default: 0.4,
    step: 0.01,
  },
  armLength: {
    label: "팔 길이 (어깨–손목)",
    unit: "H",
    min: 0.62,
    max: 0.96,
    default: 0.8,
    step: 0.01,
  },
  upperArmThickness: {
    label: "위팔 두께",
    unit: "H",
    min: 0.17,
    max: 0.29,
    default: 0.22,
    step: 0.01,
  },
  forearmThickness: {
    label: "아래팔 두께",
    unit: "H",
    min: 0.15,
    max: 0.26,
    default: 0.19,
    step: 0.01,
  },
  handSize: {
    label: "손 크기",
    unit: "×",
    min: 0.8,
    max: 1.25,
    default: 1,
    step: 0.01,
  },
  legLengthRatio: {
    label: "다리 길이 배분",
    unit: "비율",
    min: 0.48,
    max: 0.65,
    default: 0.56,
    step: 0.01,
  },
  thighThickness: {
    label: "허벅지 두께",
    unit: "H",
    min: 0.2,
    max: 0.33,
    default: 0.26,
    step: 0.01,
  },
  calfThickness: {
    label: "종아리 두께",
    unit: "H",
    min: 0.17,
    max: 0.28,
    default: 0.22,
    step: 0.01,
  },
  footSize: {
    label: "발 크기",
    unit: "×",
    min: 0.8,
    max: 1.2,
    default: 1,
    step: 0.01,
  },
} as const;
export type BodyShape = {
  -readonly [K in keyof typeof BODY_PARAMETERS]: number;
};
export type BodyKey = keyof BodyShape;
export const BODY_KEYS = Object.keys(BODY_PARAMETERS) as BodyKey[];
export const DEFAULT_BODY: Readonly<BodyShape> = Object.freeze(
  Object.fromEntries(
    BODY_KEYS.map((k) => [k, BODY_PARAMETERS[k].default]),
  ) as BodyShape,
);
export const CHARACTER_SCALE = {
  min: 0.65,
  max: 1.5,
  default: 1,
  unit: "×",
} as const;
export const BODY_PRESETS = {
  default: DEFAULT_BODY,
  slim: {
    ...DEFAULT_BODY,
    chestWidth: 0.55,
    waistWidth: 0.42,
    pelvisWidth: 0.53,
    upperArmThickness: 0.18,
    thighThickness: 0.21,
    legLengthRatio: 0.62,
  },
  round: {
    ...DEFAULT_BODY,
    chestWidth: 0.86,
    chestDepth: 0.56,
    waistWidth: 0.7,
    waistDepth: 0.49,
    pelvisWidth: 0.8,
    thighThickness: 0.32,
    shoulderWidth: 1.05,
  },
  broad: {
    ...DEFAULT_BODY,
    shoulderWidth: 1.15,
    chestWidth: 0.85,
    upperArmThickness: 0.28,
    waistWidth: 0.48,
  },
} satisfies Record<string, Readonly<BodyShape>>;
export type BodyPreset = keyof typeof BODY_PRESETS;
export function finiteRange(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new RangeError(
      `${name}: ${min}–${max} 범위의 유한한 숫자가 필요합니다.`,
    );
  return value;
}
export function validateBodyShape(
  input: unknown,
  base: Readonly<BodyShape> = DEFAULT_BODY,
): BodyShape {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("체형은 JSON 객체여야 합니다.");
  const next = { ...base };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(BODY_PARAMETERS, key))
      throw new TypeError(`알 수 없는 체형 항목: ${key}`);
    const k = key as BodyKey,
      p = BODY_PARAMETERS[k];
    next[k] = finiteRange(value, p.min, p.max, key);
  }
  return next;
}
export interface BodyConfiguration {
  version: 1;
  characterScale: number;
  body: BodyShape;
}
export function serializeBody(body: BodyShape, characterScale = 1): string {
  return JSON.stringify(
    {
      version: 1,
      characterScale: finiteRange(characterScale, 0.65, 1.5, "characterScale"),
      body: validateBodyShape(body),
    },
    null,
    2,
  );
}
export function parseBody(json: string): BodyConfiguration {
  const data: unknown = JSON.parse(json);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new TypeError("설정 객체가 필요합니다.");
  const d = data as Record<string, unknown>;
  if (
    d.version !== 1 ||
    Object.keys(d).some(
      (k) => !["version", "characterScale", "body"].includes(k),
    )
  )
    throw new TypeError("지원하지 않는 설정 형식입니다 (version: 1).");
  if (
    !d.body ||
    typeof d.body !== "object" ||
    Object.keys(d.body).length !== BODY_KEYS.length
  )
    throw new TypeError("JSON에는 모든 체형 항목이 필요합니다.");
  return {
    version: 1,
    characterScale: finiteRange(d.characterScale, 0.65, 1.5, "characterScale"),
    body: validateBodyShape(d.body),
  };
}
export function deriveDimensions(s: Readonly<BodyShape>) {
  const head = 1,
    belowHead = 2,
    neck = 0.12,
    pelvis = 0.24,
    foot = 0.16 * s.footSize;
  const available = belowHead - neck - pelvis - foot;
  const leg = available * s.legLengthRatio,
    torso = available - leg;
  // Socket spread includes the thickest permitted leg/foot, preventing crossed rest feet.
  const hipSpread = Math.max(
    s.pelvisWidth * 0.58,
    s.thighThickness + 0.07,
    0.26 * s.footSize + 0.06,
  );
  const shoulderSpread = Math.max(
    s.shoulderWidth,
    s.chestWidth + s.upperArmThickness * 0.65,
  );
  return {
    head,
    belowHead,
    height: head + belowHead,
    neck,
    pelvis,
    foot,
    leg,
    torso,
    thigh: leg * 0.51,
    calf: leg * 0.49,
    upperArm: s.armLength * 0.52,
    forearm: s.armLength * 0.48,
    hipY: foot + leg,
    shoulderY: 2 - neck - 0.12,
    hipSpread,
    shoulderSpread,
  };
}
export type RigDimensions = ReturnType<typeof deriveDimensions>;
