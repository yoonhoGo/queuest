import type { Character } from "@queuest/domain";
import {
  SPRITE_HEIGHT,
  SPRITE_STATE_LABEL,
  SPRITE_WIDTH,
  composeSpriteFrame,
  resolveSpriteAppearance,
  spriteFrameToPixels,
  refineSpritePixels,
} from "./sprite.ts";
import type { SpriteState } from "./sprite.ts";

const JOB_LABEL: Record<Character["job"], string> = {
  developer: "개발자",
  planner: "기획자",
  designer: "디자이너",
};

export interface CharacterSpriteProps {
  character: Character;
  state?: SpriteState;
  /** Rendered width in CSS px; height follows the 12:14 grid. */
  size?: number;
}

export function CharacterSprite({ character, state = "idle", size = 48 }: CharacterSpriteProps) {
  const appearance = resolveSpriteAppearance(character);
  const job = appearance.style;
  const label = `${JOB_LABEL[character.job]} ${character.name} 도트 캐릭터, ${SPRITE_STATE_LABEL[state]}`;
  return (
    <div className={`sprite sprite-${job} sprite-state-${state}`} data-state={state}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${SPRITE_WIDTH * 2} ${SPRITE_HEIGHT * 2}`}
        width={size}
        height={(size * SPRITE_HEIGHT) / SPRITE_WIDTH}
        shapeRendering="crispEdges"
      >
        <title>{label}</title>
        {([0, 1] as const).map((frame) => (
          <g key={frame} className="sprite-frame" data-frame={frame}>
            {refineSpritePixels(spriteFrameToPixels(job, composeSpriteFrame(job, state, frame), appearance)).map((pixel) => (
              <rect key={`${pixel.x}-${pixel.y}`} x={pixel.x} y={pixel.y} width={1} height={1} fill={pixel.fill} />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
