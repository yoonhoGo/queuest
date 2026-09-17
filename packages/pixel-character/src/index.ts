export { PixelCharacterEngine } from "./engine.ts";
export type { EngineOptions, Movement } from "./engine.ts";
export {
  BODY_PARAMETERS,
  BODY_KEYS,
  BODY_PRESETS,
  DEFAULT_BODY,
  CHARACTER_SCALE,
  deriveDimensions,
  validateBodyShape,
  parseBody,
  serializeBody,
} from "./body.ts";
export type {
  BodyShape,
  BodyKey,
  BodyPreset,
  RigDimensions,
  BodyConfiguration,
} from "./body.ts";
export { DEFAULT_STYLE } from "./style.ts";
export type { PixelStyle } from "./style.ts";
export type { Resolution } from "./renderer.ts";
export { ProceduralCharacter } from "./character.ts";
export type { CharacterAdapter } from "./character.ts";
export { CharacterAnimator, JOINT_LIMITS } from "./animator.ts";
export type { Action, PoseOverride, JointRotation } from "./animator.ts";
export { CharacterRig, JOINT_NAMES } from "./rig.ts";
export type { JointName } from "./rig.ts";
